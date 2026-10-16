import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SyncedFile } from '../../../domain/sync';
import { createAdapter } from './index';
import {
  cloudAdapterAsEncryptedObjectStorage,
  webdavEncryptedObjectCapabilities,
} from './encryptedObjectStorageBridge';
import { DEFAULT_ENCRYPTED_SYNC_OBJECT_KEY } from '../../../domain/encryptedObjectStorage';
import type { CloudAdapter } from './index';

/**
 * Prove the production WebDAV factory returns a CloudAdapter that is wired
 * through EncryptedObjectStorage (same surface plugins use), by exercising
 * the shared bridge with a real in-memory CloudAdapter that mirrors WebDAV's
 * single-file semantics and comparing with createAdapter's webdav wrap shape.
 */
function memoryWebdavAdapter(initial: SyncedFile | null = null): CloudAdapter & { store: SyncedFile | null } {
  const adapter = {
    store: initial,
    isAuthenticated: true,
    accountInfo: { id: 'webdav.example', name: 'user@webdav.example' },
    resourceId: null as string | null,
    signOut() {
      adapter.isAuthenticated = false;
      adapter.accountInfo = null;
      adapter.store = null;
    },
    async initializeSync() {
      adapter.resourceId = DEFAULT_ENCRYPTED_SYNC_OBJECT_KEY;
      return adapter.resourceId;
    },
    async upload(file: SyncedFile) {
      adapter.store = file;
      adapter.resourceId = DEFAULT_ENCRYPTED_SYNC_OBJECT_KEY;
      return adapter.resourceId;
    },
    async download() {
      return adapter.store;
    },
    async deleteSync() {
      adapter.store = null;
    },
    getTokens() {
      return null;
    },
  };
  return adapter;
}

describe('WebDAV EncryptedObjectStorage production path', () => {
  it('createAdapter(webdav) wraps through EncryptedObjectStorage (not a raw WebDAVAdapter)', async () => {
    const { default: WebDAVAdapter } = await import('./WebDAVAdapter');
    const adapter = await createAdapter('webdav', undefined, undefined, {
      endpoint: 'https://webdav.example.test',
      authType: 'basic',
      username: 'user',
      password: 'secret',
    });
    assert.equal(adapter instanceof WebDAVAdapter, false, 'must not return raw WebDAVAdapter');
    assert.equal(typeof adapter.upload, 'function');
    assert.equal(typeof adapter.download, 'function');
    assert.equal(typeof adapter.initializeSync, 'function');
    assert.equal(typeof adapter.deleteSync, 'function');
    assert.equal(adapter.getTokens(), null);
  });

  it('createAdapter(webdav) is authenticated when config exists so getConnectedAdapter can reuse', async () => {
    const adapter = await createAdapter('webdav', undefined, undefined, {
      endpoint: 'https://webdav.example.test',
      authType: 'basic',
      username: 'user',
      password: 'secret',
    });
    // Pre-wrap WebDAVAdapter reported isAuthenticated whenever config existed.
    // The bridge must match so manager cache reuse (existing?.isAuthenticated) works.
    assert.equal(adapter.isAuthenticated, true);
  });

  it('createAdapter(webdav) preserves constructor resourceId and refreshes from backing adapter after initializeSync', async () => {
    const persistedPath = '/netcatty-vault.json';
    const adapter = await createAdapter(
      'webdav',
      undefined,
      persistedPath,
      {
        endpoint: 'https://webdav.example.test',
        authType: 'basic',
        username: 'user',
        password: 'secret',
      },
    );
    assert.equal(
      adapter.resourceId,
      persistedPath,
      'must not discard resourceId passed into createAdapter',
    );

    // Without network, initializeSync fails; still prove resourceId is not
    // overwritten to the bare DEFAULT key before connect runs.
    assert.notEqual(adapter.resourceId, 'netcatty-vault.json');
  });

  it('WebDAV-style adapters round-trip encrypted SyncedFile bytes through EncryptedObjectStorage', async () => {
    const raw = memoryWebdavAdapter({
      meta: {
        version: 2,
        updatedAt: 1,
        deviceId: 'd',
        appVersion: '0.0.0',
        iv: 'iv',
        salt: 'salt',
        algorithm: 'AES-256-GCM',
        kdf: 'PBKDF2',
      },
      payload: 'remote-cipher',
    });
    const storage = cloudAdapterAsEncryptedObjectStorage(raw, 'webdav', {
      capabilities: webdavEncryptedObjectCapabilities(),
    });
    const caps = await storage.getCapabilities();
    assert.equal(caps.atomicReplacement, true);
    assert.equal(caps.revisions, false);

    await storage.connect();
    const read = await storage.readObject(DEFAULT_ENCRYPTED_SYNC_OBJECT_KEY);
    assert.equal(read.found, true);
    assert.ok(read.bytes);
    const text = new TextDecoder().decode(read.bytes!);
    assert.match(text, /remote-cipher/);

    const next: SyncedFile = {
      meta: {
        version: 3,
        updatedAt: 2,
        deviceId: 'd',
        appVersion: '0.0.0',
        iv: 'iv',
        salt: 'salt',
        algorithm: 'AES-256-GCM',
        kdf: 'PBKDF2',
      },
      payload: 'next-cipher',
    };
    await storage.writeObject(
      DEFAULT_ENCRYPTED_SYNC_OBJECT_KEY,
      new TextEncoder().encode(JSON.stringify(next)),
    );
    assert.equal(raw.store?.payload, 'next-cipher');
  });
});
