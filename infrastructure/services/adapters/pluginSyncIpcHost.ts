/**
 * Renderer-side host that drives plugin sync Providers over the preload IPC
 * surface. Main process extensionProviderService owns activation, permission
 * checks, and stream handling; this client shuttles already-encrypted object
 * bytes with inline Uint8Array for small objects and pull/chunked transfers
 * above the SyncLimits inline cutoff.
 */

import {
  PLUGIN_SYNC_INLINE_OBJECT_BYTES,
} from '@netcatty/plugin-contract';
import type {
  EncryptedObjectAccount,
  EncryptedObjectStorageCapabilities,
} from '../../../domain/encryptedObjectStorage';
import type { PluginSyncProviderHost } from './pluginSyncObjectStorage';

/** Match host STREAM_WINDOW_BYTES so each IPC chunk maps 1:1 to a plugin stream write. */
const STREAM_WINDOW_BYTES = 256 * 1024;
/** Same as main INLINE_SYNC_OBJECT_SAFE_BYTES (aligned SyncLimits.inlineObjectBytes). */
const INLINE_SYNC_OBJECT_SAFE_BYTES = PLUGIN_SYNC_INLINE_OBJECT_BYTES;

type ElectronPluginSyncApi = {
  cancelPluginExtensionRequest?: (requestId: string) => Promise<boolean>;
  pluginSyncConnect?: (params: {
    requestId: string;
    providerId: string;
    configuration?: unknown;
    credential?: unknown;
    deadlineMs?: number;
  }) => Promise<{ account: EncryptedObjectAccount }>;
  pluginSyncDisconnect?: (params: {
    requestId: string;
    providerId: string;
    deadlineMs?: number;
  }) => Promise<null>;
  pluginSyncGetAccount?: (params: {
    requestId: string;
    providerId: string;
    deadlineMs?: number;
  }) => Promise<{ account: EncryptedObjectAccount | null }>;
  pluginSyncGetCapabilities?: (params: {
    requestId: string;
    providerId: string;
    deadlineMs?: number;
  }) => Promise<EncryptedObjectStorageCapabilities>;
  pluginSyncReadObject?: (params: {
    requestId: string;
    providerId: string;
    key: string;
    preferStream?: boolean;
    deadlineMs?: number;
  }) => Promise<{
    found: boolean;
    key: string;
    data?: Uint8Array | null;
    streamed?: boolean;
    transferId?: string;
    byteLength?: number;
    revision?: string;
    contentType?: string;
  }>;
  pluginSyncReadChunk?: (params: {
    requestId: string;
    transferId: string;
    maxBytes?: number;
  }) => Promise<{ chunk: Uint8Array; done: boolean }>;
  pluginSyncWriteObject?: (params: {
    requestId: string;
    providerId: string;
    key: string;
    data: Uint8Array;
    expectedRevision?: string | null;
    preferStream?: boolean;
    deadlineMs?: number;
  }) => Promise<{ created: boolean; revision?: string }>;
  pluginSyncWriteBegin?: (params: {
    requestId: string;
    providerId: string;
    key: string;
    byteLength: number;
    expectedRevision?: string | null;
    deadlineMs?: number;
  }) => Promise<{ transferId: string; windowBytes: number }>;
  pluginSyncWriteChunk?: (params: {
    requestId: string;
    transferId: string;
    sequence: number;
    chunk: Uint8Array;
  }) => Promise<{ accepted: number }>;
  pluginSyncWriteCommit?: (params: {
    requestId: string;
    transferId: string;
  }) => Promise<{ created: boolean; revision?: string }>;
  pluginSyncDeleteObject?: (params: {
    requestId: string;
    providerId: string;
    key: string;
    expectedRevision?: string;
    deadlineMs?: number;
  }) => Promise<{ deleted: boolean }>;
  pluginSyncPutSecret?: (params: {
    providerId: string;
    key: string;
    value: string;
  }) => Promise<{ kind: 'secret'; id: string; key: string; created?: boolean }>;
  pluginSyncDeleteSecrets?: (params: {
    providerId: string;
    keys?: string[];
  }) => Promise<{ deleted: number }>;
  pluginSyncRestoreSecrets?: (params: {
    providerId: string;
    keys: string[];
    discard?: boolean;
  }) => Promise<{ restored: number; discarded?: number }>;
};

function getPluginSyncApi(): ElectronPluginSyncApi | null {
  if (typeof window === 'undefined') return null;
  // Preload exposes the production bridge as window.netcatty only.
  const bridge = (window as Window & {
    netcatty?: ElectronPluginSyncApi;
    electron?: ElectronPluginSyncApi;
  }).netcatty
    ?? (window as Window & { electron?: ElectronPluginSyncApi }).electron;
  return bridge ?? null;
}

function mintRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sync-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function coerceBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (value && typeof value === 'object' && (value as { type?: string }).type === 'Buffer'
    && Array.isArray((value as { data?: unknown }).data)) {
    return Uint8Array.from((value as { data: number[] }).data);
  }
  throw new Error('Plugin sync IPC expected binary bytes');
}

async function withAbortSignal<T>(
  api: ElectronPluginSyncApi,
  signal: AbortSignal | undefined,
  run: (requestId: string) => Promise<T>,
): Promise<T> {
  const requestId = mintRequestId();
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  let onAbort: (() => void) | undefined;
  if (signal) {
    onAbort = () => {
      void api.cancelPluginExtensionRequest?.(requestId).catch(() => false);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    return await run(requestId);
  } catch (error) {
    // Release main-process transfer / abort controller on stream or RPC failure
    // even when the caller did not abort (TTL alone is not enough).
    try {
      await api.cancelPluginExtensionRequest?.(requestId);
    } catch {
      /* ignore */
    }
    throw error;
  } finally {
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
}

export function isPluginSyncIpcAvailable(): boolean {
  const api = getPluginSyncApi();
  if (
    typeof api?.pluginSyncConnect !== 'function'
    || typeof api?.pluginSyncReadObject !== 'function'
    || typeof api?.pluginSyncWriteObject !== 'function'
  ) {
    return false;
  }
  // Preload always exposes the IPC methods; the host is only ready when the
  // main process has a live plugin host (sync sidecar service wired).
  const ready = (api as { pluginHostReady?: () => boolean }).pluginHostReady;
  if (typeof ready === 'function') {
    try {
      return ready() === true;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Create a PluginSyncProviderHost bound to the renderer preload API.
 * Throws when the plugin development gate / host is unavailable.
 */
export function createPluginSyncIpcHost(): PluginSyncProviderHost {
  return {
    async connectSync(params, options) {
      const api = getPluginSyncApi();
      if (typeof api?.pluginSyncConnect !== 'function') {
        throw new Error('Plugin sync host is unavailable');
      }
      return withAbortSignal(api, options?.signal, (requestId) => api.pluginSyncConnect!({
        ...params,
        requestId,
      }));
    },
    async disconnectSync(params, options) {
      const api = getPluginSyncApi();
      if (typeof api?.pluginSyncDisconnect !== 'function') {
        throw new Error('Plugin sync host is unavailable');
      }
      return withAbortSignal(api, options?.signal, (requestId) => api.pluginSyncDisconnect!({
        ...params,
        requestId,
      }));
    },
    async getSyncAccount(params, options) {
      const api = getPluginSyncApi();
      if (typeof api?.pluginSyncGetAccount !== 'function') {
        throw new Error('Plugin sync host is unavailable');
      }
      return withAbortSignal(api, options?.signal, (requestId) => api.pluginSyncGetAccount!({
        ...params,
        requestId,
      }));
    },
    async getSyncCapabilities(params, options) {
      const api = getPluginSyncApi();
      if (typeof api?.pluginSyncGetCapabilities !== 'function') {
        throw new Error('Plugin sync host is unavailable');
      }
      return withAbortSignal(api, options?.signal, (requestId) => api.pluginSyncGetCapabilities!({
        ...params,
        requestId,
      }));
    },
    async readSyncObject(params, options) {
      const api = getPluginSyncApi();
      if (typeof api?.pluginSyncReadObject !== 'function') {
        throw new Error('Plugin sync host is unavailable');
      }
      return withAbortSignal(api, options?.signal, async (requestId) => {
        const preferStream = params.preferStream === true;
        const result = await api.pluginSyncReadObject!({
          ...params,
          preferStream,
          requestId,
        });
        if (!result.found) {
          return { found: false, key: params.key, bytes: null };
        }
        if (result.streamed === true && typeof result.transferId === 'string') {
          if (typeof api.pluginSyncReadChunk !== 'function') {
            throw new Error('Plugin sync streamed read is unavailable');
          }
          const total = result.byteLength;
          if (!Number.isSafeInteger(total) || total < 1) {
            throw new Error('Plugin sync streamed read missing byteLength');
          }
          const parts: Uint8Array[] = [];
          let received = 0;
          for (;;) {
            if (options?.signal?.aborted) {
              throw new DOMException('Aborted', 'AbortError');
            }
            const { chunk, done } = await api.pluginSyncReadChunk({
              requestId,
              transferId: result.transferId,
              maxBytes: STREAM_WINDOW_BYTES,
            });
            const bytes = coerceBytes(chunk);
            parts.push(bytes);
            received += bytes.byteLength;
            if (received > total) {
              throw new Error('Plugin sync read exceeded declared byteLength');
            }
            if (done) break;
          }
          if (received !== total) {
            throw new Error('Plugin sync read size does not match byteLength');
          }
          const merged = new Uint8Array(received);
          let offset = 0;
          for (const part of parts) {
            merged.set(part, offset);
            offset += part.byteLength;
          }
          return {
            found: true,
            key: result.key,
            bytes: merged,
            revision: result.revision,
            contentType: result.contentType,
          };
        }
        if (result.data == null) {
          return { found: false, key: params.key, bytes: null };
        }
        return {
          found: true,
          key: result.key,
          bytes: coerceBytes(result.data),
          revision: result.revision,
          contentType: result.contentType,
        };
      });
    },
    async writeSyncObject(params, options) {
      const api = getPluginSyncApi();
      if (typeof api?.pluginSyncWriteObject !== 'function') {
        throw new Error('Plugin sync host is unavailable');
      }
      return withAbortSignal(api, options?.signal, async (requestId) => {
        const bytes = params.bytes instanceof Uint8Array
          ? params.bytes
          : new Uint8Array(params.bytes);
        const useStream = bytes.byteLength > INLINE_SYNC_OBJECT_SAFE_BYTES
          || params.preferStream === true;
        if (!useStream) {
          return api.pluginSyncWriteObject!({
            requestId,
            providerId: params.providerId,
            key: params.key,
            data: bytes,
            expectedRevision: params.expectedRevision,
            preferStream: false,
            deadlineMs: params.deadlineMs,
          });
        }
        if (
          typeof api.pluginSyncWriteBegin !== 'function'
          || typeof api.pluginSyncWriteChunk !== 'function'
          || typeof api.pluginSyncWriteCommit !== 'function'
        ) {
          throw new Error('Plugin sync streamed write is unavailable');
        }
        const { transferId, windowBytes } = await api.pluginSyncWriteBegin({
          requestId,
          providerId: params.providerId,
          key: params.key,
          byteLength: bytes.byteLength,
          expectedRevision: params.expectedRevision,
          deadlineMs: params.deadlineMs,
        });
        const chunkSize = Number.isSafeInteger(windowBytes) && windowBytes > 0
          ? Math.min(windowBytes, STREAM_WINDOW_BYTES)
          : STREAM_WINDOW_BYTES;
        let sequence = 0;
        for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
          if (options?.signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }
          const end = Math.min(bytes.byteLength, offset + chunkSize);
          await api.pluginSyncWriteChunk({
            requestId,
            transferId,
            sequence,
            chunk: bytes.subarray(offset, end),
          });
          sequence += 1;
        }
        return api.pluginSyncWriteCommit({ requestId, transferId });
      });
    },
    async deleteSyncObject(params, options) {
      const api = getPluginSyncApi();
      if (typeof api?.pluginSyncDeleteObject !== 'function') {
        throw new Error('Plugin sync host is unavailable');
      }
      return withAbortSignal(api, options?.signal, (requestId) => api.pluginSyncDeleteObject!({
        ...params,
        requestId,
      }));
    },
  };
}

/** Store a sync credential in the OS-backed plugin secret store; returns an opaque SecretRef. */
export async function putPluginSyncSecret(params: {
  providerId: string;
  key?: string;
  value: string;
}): Promise<{ kind: 'secret'; id: string; key: string; created?: boolean }> {
  const api = getPluginSyncApi();
  if (typeof api?.pluginSyncPutSecret !== 'function') {
    throw new Error('Plugin sync secret storage is unavailable');
  }
  return api.pluginSyncPutSecret({
    providerId: params.providerId,
    key: params.key ?? 'sync-credential',
    value: params.value,
  });
}

/** Best-effort delete of OS-backed sync secrets for a plugin provider (disconnect cleanup). */
export async function deletePluginSyncSecrets(params: {
  providerId: string;
  keys?: string[];
}): Promise<{ deleted: number }> {
  const api = getPluginSyncApi();
  if (typeof api?.pluginSyncDeleteSecrets !== 'function') {
    return { deleted: 0 };
  }
  return api.pluginSyncDeleteSecrets({
    providerId: params.providerId,
    ...(params.keys ? { keys: [...params.keys] } : {}),
  });
}

/** Restore host-stashed plaintext after a rejected overwrite during reconnect. */
export async function restorePluginSyncSecrets(params: {
  providerId: string;
  keys: string[];
  discard?: boolean;
}): Promise<{ restored: number; discarded?: number }> {
  const api = getPluginSyncApi();
  if (typeof api?.pluginSyncRestoreSecrets !== 'function') {
    return { restored: 0, discarded: 0 };
  }
  return api.pluginSyncRestoreSecrets({
    providerId: params.providerId,
    keys: [...params.keys],
    ...(params.discard === true ? { discard: true } : {}),
  });
}
