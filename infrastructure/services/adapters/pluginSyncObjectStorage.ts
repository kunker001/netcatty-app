/**
 * EncryptedObjectStorage implementation that drives a plugin sync Provider
 * through the host extension Provider service. Plugins only ever see already
 * encrypted object bytes — never the master key or plaintext vault.
 */

import type {
  EncryptedObjectAccount,
  EncryptedObjectDeleteResult,
  EncryptedObjectReadResult,
  EncryptedObjectStorage,
  EncryptedObjectStorageCapabilities,
  EncryptedObjectWriteResult,
} from '../../../domain/encryptedObjectStorage';
import type { PluginSyncCredentialRef as DurablePluginSyncCredentialRef } from '../../../domain/sync';

/**
 * SyncConnectPayload.credential — includes one-shot leases for live connect.
 * Durable reconnect persistence only keeps secret/credential refs (see domain).
 */
export type PluginSyncCredentialRef =
  | DurablePluginSyncCredentialRef
  | { kind: 'secret-lease'; id: string; key?: string; operationId?: string; expiresAt?: number };

export type { DurablePluginSyncCredentialRef };

export interface PluginSyncProviderHost {
  connectSync(
    params: {
      providerId: string;
      configuration?: unknown;
      credential?: PluginSyncCredentialRef;
      deadlineMs?: number;
    },
    options?: { signal?: AbortSignal },
  ): Promise<{ account: EncryptedObjectAccount }>;
  disconnectSync(
    params: { providerId: string; deadlineMs?: number },
    options?: { signal?: AbortSignal },
  ): Promise<null>;
  getSyncAccount(
    params: { providerId: string; deadlineMs?: number },
    options?: { signal?: AbortSignal },
  ): Promise<{ account: EncryptedObjectAccount | null }>;
  getSyncCapabilities(
    params: { providerId: string; deadlineMs?: number },
    options?: { signal?: AbortSignal },
  ): Promise<EncryptedObjectStorageCapabilities>;
  readSyncObject(
    params: { providerId: string; key: string; preferStream?: boolean; deadlineMs?: number },
    options?: { signal?: AbortSignal },
  ): Promise<{
    found: boolean;
    key: string;
    bytes: Uint8Array | null;
    revision?: string;
    contentType?: string;
  }>;
  writeSyncObject(
    params: {
      providerId: string;
      key: string;
      bytes: Uint8Array;
      expectedRevision?: string | null;
      preferStream?: boolean;
      deadlineMs?: number;
    },
    options?: { signal?: AbortSignal },
  ): Promise<{ created: boolean; revision?: string }>;
  deleteSyncObject(
    params: { providerId: string; key: string; expectedRevision?: string; deadlineMs?: number },
    options?: { signal?: AbortSignal },
  ): Promise<{ deleted: boolean }>;
}

export function createPluginSyncObjectStorage(options: {
  providerId: string;
  host: PluginSyncProviderHost;
  configuration?: unknown;
  /** Canonical SyncConnectPayload.credential for host-owned secret refs. */
  credential?: PluginSyncCredentialRef;
  deadlineMs?: number;
}): EncryptedObjectStorage {
  const { providerId, host, configuration, credential, deadlineMs } = options;

  return {
    providerId,
    async connect(connectConfiguration, connectOptions): Promise<{ account: EncryptedObjectAccount }> {
      // Only treat undefined as "use stored / default". Explicit null is a
      // valid JSON configuration for schemas with type: "null".
      const resolvedConfiguration = connectConfiguration !== undefined
        ? connectConfiguration
        : (configuration !== undefined ? configuration : {});
      return host.connectSync({
        providerId,
        configuration: resolvedConfiguration,
        ...(credential ? { credential } : {}),
        deadlineMs,
      }, { signal: connectOptions?.signal });
    },
    async disconnect(disconnectOptions): Promise<void> {
      await host.disconnectSync({ providerId, deadlineMs }, { signal: disconnectOptions?.signal });
    },
    async getAccount(accountOptions): Promise<EncryptedObjectAccount | null> {
      const result = await host.getSyncAccount({ providerId, deadlineMs }, { signal: accountOptions?.signal });
      return result.account ?? null;
    },
    async getCapabilities(capOptions): Promise<EncryptedObjectStorageCapabilities> {
      return host.getSyncCapabilities({ providerId, deadlineMs }, { signal: capOptions?.signal });
    },
    async readObject(key, readOptions): Promise<EncryptedObjectReadResult> {
      return host.readSyncObject({
        providerId,
        key,
        preferStream: readOptions?.preferStream,
        deadlineMs,
      }, { signal: readOptions?.signal });
    },
    async writeObject(key, bytes, writeOptions): Promise<EncryptedObjectWriteResult> {
      return host.writeSyncObject({
        providerId,
        key,
        bytes,
        expectedRevision: writeOptions?.expectedRevision,
        preferStream: writeOptions?.preferStream,
        deadlineMs,
      }, { signal: writeOptions?.signal });
    },
    async deleteObject(key, deleteOptions): Promise<EncryptedObjectDeleteResult> {
      return host.deleteSyncObject({
        providerId,
        key,
        expectedRevision: deleteOptions?.expectedRevision,
        deadlineMs,
      }, { signal: deleteOptions?.signal });
    },
  };
}
