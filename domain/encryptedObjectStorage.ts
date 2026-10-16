/**
 * Shared encrypted-object storage surface for built-in cloud adapters and
 * plugin sync Providers. Netcatty always encrypts before write and decrypts
 * after read; implementations only handle already-encrypted bytes.
 */

export interface EncryptedObjectAccount {
  id: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
}

export interface EncryptedObjectStorageCapabilities {
  revisions: boolean;
  conditionalWrites: boolean;
  atomicReplacement: boolean;
  maxObjectBytes?: number;
  maxObjects?: number;
}

export interface EncryptedObjectReadResult {
  found: boolean;
  key: string;
  bytes: Uint8Array | null;
  revision?: string;
  contentType?: string;
}

export interface EncryptedObjectWriteResult {
  created: boolean;
  revision?: string;
}

export interface EncryptedObjectDeleteResult {
  deleted: boolean;
}

export interface EncryptedObjectWriteOptions {
  /** When set, the write is conditional on the current remote revision. `null` means the object must not exist. */
  expectedRevision?: string | null;
  signal?: AbortSignal;
}

export interface EncryptedObjectDeleteOptions {
  expectedRevision?: string;
  signal?: AbortSignal;
}

/**
 * Provider-agnostic encrypted object store. Plugins and WebDAV both implement
 * this shape so CloudSyncManager can encrypt→write / read→decrypt without
 * special-casing storage backends.
 */
export interface EncryptedObjectStorage {
  readonly providerId: string;
  connect(configuration?: unknown, options?: { signal?: AbortSignal }): Promise<{ account: EncryptedObjectAccount }>;
  disconnect(options?: { signal?: AbortSignal }): Promise<void>;
  getAccount(options?: { signal?: AbortSignal }): Promise<EncryptedObjectAccount | null>;
  getCapabilities(options?: { signal?: AbortSignal }): Promise<EncryptedObjectStorageCapabilities>;
  readObject(key: string, options?: { signal?: AbortSignal; preferStream?: boolean }): Promise<EncryptedObjectReadResult>;
  writeObject(
    key: string,
    bytes: Uint8Array,
    options?: EncryptedObjectWriteOptions & { preferStream?: boolean },
  ): Promise<EncryptedObjectWriteResult>;
  deleteObject(key: string, options?: EncryptedObjectDeleteOptions): Promise<EncryptedObjectDeleteResult>;
}

/** Default object key used when adapting the legacy single-file CloudAdapter path. */
export const DEFAULT_ENCRYPTED_SYNC_OBJECT_KEY = 'netcatty-vault.json';
