/**
 * WebDAV Adapter - webdav client library
 */

import { AuthType, createClient } from 'webdav';
import {
  SYNC_CONSTANTS,
  type WebDAVConfig,
  type SyncedFile,
  type ProviderAccount,
  type OAuthTokens,
} from '../../../domain/sync';
import { netcattyBridge } from '../netcattyBridge';

type WebDAVClient = ReturnType<typeof createClient>;

const normalizeEndpoint = (endpoint: string): string => {
  const trimmed = endpoint.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
};

const ensureLeadingSlash = (value: string): string =>
  value.startsWith('/') ? value : `/${value}`;

/**
 * Recover from trailing garbage left by non-truncating WebDAV PUT overwrites
 * (#2223). Node/V8: "Unexpected non-whitespace character after JSON at position N".
 */
const parseSyncedFileJson = (raw: string): SyncedFile => {
  try {
    return JSON.parse(raw) as SyncedFile;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const match = /Unexpected non-whitespace character after JSON at position (\d+)/i.exec(
      message,
    );
    if (match) {
      const pos = Number(match[1]);
      if (Number.isFinite(pos) && pos > 0 && pos <= raw.length) {
        return JSON.parse(raw.slice(0, pos)) as SyncedFile;
      }
    }
    throw error;
  }
};

const utf8ByteLength = (value: string): number =>
  typeof Buffer !== 'undefined'
    ? Buffer.byteLength(value, 'utf8')
    : new TextEncoder().encode(value).length;

/** Strict: intended body plus optional trailing whitespace only. */
const remoteMatchesUploadedBody = (remoteText: string, body: string): boolean => {
  if (!remoteText.startsWith(body)) return false;
  return /^\s*$/.test(remoteText.slice(body.length));
};

/**
 * Prefer fixed-name temp PUT + MOVE (with pad + verify); else padded in-place
 * PUT with strict body match so non-truncating servers cannot leave garbage.
 */
const putWebdavFileReplacing = async (
  client: WebDAVClient,
  path: string,
  body: string,
): Promise<void> => {
  const tmpPath = `${path}.tmp`;
  const bodyLen = utf8ByteLength(body);

  const cleanupTemp = async () => {
    try {
      if (await client.exists(tmpPath)) {
        await client.deleteFile(tmpPath);
      }
    } catch {
      // best-effort
    }
  };

  const readLen = async (target: string): Promise<number> => {
    let exists = false;
    try {
      exists = await client.exists(target);
    } catch (error) {
      throw new Error(
        `WebDAV replace aborted: could not check existing file (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
    if (!exists) return 0;
    try {
      const existing = await client.getFileContents(target, { format: 'text' });
      if (existing == null) return 0;
      return utf8ByteLength(String(existing));
    } catch (error) {
      throw new Error(
        `WebDAV replace aborted: could not read existing file length (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
  };

  try {
    let tmpMin = 0;
    try {
      tmpMin = await readLen(tmpPath);
    } catch {
      tmpMin = 0;
    }
    const tmpBody = tmpMin > bodyLen ? body + ' '.repeat(tmpMin - bodyLen) : body;
    await client.putFileContents(tmpPath, tmpBody, { overwrite: true });
    await client.moveFile(tmpPath, path, { overwrite: true });
    const moved = String((await client.getFileContents(path, { format: 'text' })) ?? '');
    if (remoteMatchesUploadedBody(moved, body)) {
      return;
    }
  } catch {
    // fall through
  }
  await cleanupTemp();

  let minLen = await readLen(path);
  minLen = Math.max(minLen, bodyLen);
  for (let attempt = 0; attempt < 3; attempt++) {
    const payload = minLen > bodyLen ? body + ' '.repeat(minLen - bodyLen) : body;
    await client.putFileContents(path, payload, { overwrite: true });
    let remoteText = '';
    try {
      remoteText = String((await client.getFileContents(path, { format: 'text' })) ?? '');
    } catch (error) {
      throw new Error(
        `WebDAV upload verification failed: could not re-read file (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
    if (remoteMatchesUploadedBody(remoteText, body)) {
      return;
    }
    minLen = Math.max(minLen, utf8ByteLength(remoteText), bodyLen);
  }
  throw new Error(
    'WebDAV upload verification failed: remote file still does not match uploaded body after padded PUT',
  );
};

export class WebDAVAdapter {
  private config: WebDAVConfig | null;
  private resource: string | null;
  private account: ProviderAccount | null;
  private client: WebDAVClient | null;

  constructor(config?: WebDAVConfig, resourceId?: string) {
    this.config = config
      ? { ...config, endpoint: normalizeEndpoint(config.endpoint) }
      : null;
    this.resource = resourceId || null;
    this.account = this.buildAccountInfo(this.config);
    this.client = this.config ? this.createClient(this.config) : null;
  }

  get isAuthenticated(): boolean {
    return !!this.config;
  }

  get accountInfo(): ProviderAccount | null {
    return this.account;
  }

  get resourceId(): string | null {
    return this.resource;
  }

  signOut(): void {
    this.config = null;
    this.resource = null;
    this.account = null;
    this.client = null;
  }

  async initializeSync(): Promise<string | null> {
    return this.withWebdavErrorContext('initialize', async () => {
      if (!this.config) {
        throw new Error('Missing WebDAV config');
      }
      const bridge = netcattyBridge.get();
      if (bridge?.cloudSyncWebdavInitialize) {
        const result = await bridge.cloudSyncWebdavInitialize(this.config);
        this.resource = result?.resourceId || this.getSyncPath();
        return this.resource;
      }
      const client = this.getClient();
      const path = this.getSyncPath();
      await client.exists(path);
      this.resource = path;
      return this.resource;
    });
  }

  async upload(syncedFile: SyncedFile): Promise<string> {
    return this.withWebdavErrorContext('upload', async () => {
      if (!this.config) {
        throw new Error('Missing WebDAV config');
      }
      const bridge = netcattyBridge.get();
      if (bridge?.cloudSyncWebdavUpload) {
        const result = await bridge.cloudSyncWebdavUpload(this.config, syncedFile);
        this.resource = result?.resourceId || this.getSyncPath();
        return this.resource;
      }
      const client = this.getClient();
      const path = this.getSyncPath();
      await putWebdavFileReplacing(client, path, JSON.stringify(syncedFile));
      this.resource = path;
      return path;
    });
  }

  async download(): Promise<SyncedFile | null> {
    return this.withWebdavErrorContext('download', async () => {
      if (!this.config) {
        throw new Error('Missing WebDAV config');
      }
      const bridge = netcattyBridge.get();
      if (bridge?.cloudSyncWebdavDownload) {
        const result = await bridge.cloudSyncWebdavDownload(this.config);
        return (result?.syncedFile ?? null) as SyncedFile | null;
      }
      const client = this.getClient();
      const path = this.getSyncPath();
      const exists = await client.exists(path);
      if (!exists) return null;
      const data = await client.getFileContents(path, { format: 'text' });
      if (!data) return null;
      return parseSyncedFileJson(data as string);
    });
  }

  async deleteSync(): Promise<void> {
    return this.withWebdavErrorContext('delete', async () => {
      if (!this.config) {
        throw new Error('Missing WebDAV config');
      }
      const bridge = netcattyBridge.get();
      if (bridge?.cloudSyncWebdavDelete) {
        await bridge.cloudSyncWebdavDelete(this.config);
        return;
      }
      const client = this.getClient();
      const path = this.getSyncPath();
      const exists = await client.exists(path);
      if (!exists) return;
      await client.deleteFile(path);
    });
  }

  getTokens(): OAuthTokens | null {
    return null;
  }

  private getClient(): WebDAVClient {
    if (!this.config || !this.client) {
      throw new Error('Missing WebDAV config');
    }
    return this.client;
  }

  private createClient(config: WebDAVConfig): WebDAVClient {
    const extraOpts: Record<string, unknown> = {};
    if (config.allowInsecure && typeof globalThis.process !== 'undefined') {
      const https = require('https');
      extraOpts.httpsAgent = new https.Agent({ rejectUnauthorized: false });
    }

    if (config.authType === 'token') {
      return createClient(config.endpoint, {
        authType: AuthType.Token,
        token: {
          access_token: config.token || '',
          token_type: 'Bearer',
        },
        ...extraOpts,
      });
    }

    if (config.authType === 'digest') {
      return createClient(config.endpoint, {
        authType: AuthType.Digest,
        username: config.username || '',
        password: config.password || '',
        ...extraOpts,
      });
    }

    return createClient(config.endpoint, {
      authType: AuthType.Password,
      username: config.username || '',
      password: config.password || '',
      ...extraOpts,
    });
  }

  private async withWebdavErrorContext<T>(
    operation: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw this.buildWebdavError(operation, error);
    }
  }

  private buildWebdavError(operation: string, error: unknown): Error {
    const baseMessage = error instanceof Error ? error.message : String(error);
    const details: Record<string, string | number | boolean | null | undefined> = {
      operation,
    };
    const raw = error as {
      status?: number;
      statusText?: string;
      url?: string;
      method?: string;
      code?: string;
      response?: {
        status?: number;
        statusText?: string;
        url?: string;
      };
      cause?: unknown;
    };

    if (raw?.status) details.status = raw.status;
    if (raw?.statusText) details.statusText = raw.statusText;
    if (raw?.url) details.url = raw.url;
    if (raw?.method) details.method = raw.method;
    if (raw?.code) details.code = raw.code;
    if (raw?.response?.status) details.status = raw.response.status;
    if (raw?.response?.statusText) details.statusText = raw.response.statusText;
    if (raw?.response?.url) details.url = raw.response.url;
    if (raw?.cause && typeof raw.cause === 'object') {
      Object.assign(details, raw.cause as Record<string, unknown>);
      details.operation = operation;
      const cause = raw.cause as { code?: string };
      if (cause?.code) details.causeCode = cause.code;
    } else if (raw?.cause) {
      details.cause = String(raw.cause);
    }

    const err = new Error(`WebDAV ${operation} failed: ${baseMessage}`);
    (err as Error & { cause?: unknown }).cause = details;
    return err;
  }

  private getSyncPath(): string {
    return ensureLeadingSlash(SYNC_CONSTANTS.SYNC_FILE_NAME);
  }

  private buildAccountInfo(config: WebDAVConfig | null): ProviderAccount | null {
    if (!config) return null;
    try {
      const url = new URL(config.endpoint);
      const host = url.host;
      const name = config.username ? `${config.username}@${host}` : host;
      return { id: host, name };
    } catch {
      return { id: config.endpoint, name: config.endpoint };
    }
  }
}

export default WebDAVAdapter;
