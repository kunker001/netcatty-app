import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CloudProvider, ProviderConnection, SyncedFile } from '../../../domain/sync';
import { SYNC_STORAGE_KEYS } from '../../../domain/sync';
import type { EncryptedObjectStorage } from '../../../domain/encryptedObjectStorage';
import { DEFAULT_ENCRYPTED_SYNC_OBJECT_KEY } from '../../../domain/encryptedObjectStorage';
import {
  enforceLegacySingleProviderConnected,
  getConnectedAdapterImpl,
  listAvailablePluginSyncProviderIdsImpl,
  listRegisteredPluginProviderIdsImpl,
  loadInitialStateImpl,
  loadProviderConnectionImpl,
  registerPluginProviderIdImpl,
  saveProviderConnectionImpl,
  setAvailablePluginSyncProviderIdsImpl,
  unregisterPluginProviderIdImpl,
} from './stateAndSecurityMethods';

function makeSyncedFile(version: number, payload = 'cipher'): SyncedFile {
  return {
    meta: {
      version,
      updatedAt: 1,
      deviceId: 'device',
      appVersion: '0.0.0',
      iv: 'iv',
      salt: 'salt',
      algorithm: 'AES-256-GCM',
      kdf: 'PBKDF2',
    },
    payload,
  };
}

function memoryStorage(): Map<string, unknown> {
  return new Map();
}

type ManagerHarness = {
  adapters: Map<string, unknown>;
  providerWriteSeq: Record<string, number>;
  providerDecryptSeq: Record<string, number>;
  providerDecrypted: Record<string, boolean>;
  providerAuthAttemptSeq: Record<string, number>;
  providerAuthRestoreState: Record<string, unknown>;
  decryptionReady: Promise<void>;
  state: { providers: Record<string, ProviderConnection> } | null;
  createPluginStorage?: (id: string) => Promise<EncryptedObjectStorage>;
  loadFromStorage: <T>(key: string) => T | null;
  saveToStorage: (key: string, value: unknown) => boolean;
  removeFromStorage: (key: string) => void;
  loadProviderConnection: (provider: CloudProvider) => ProviderConnection;
  notifyStateChange: () => void;
  isActiveAuthAttempt: () => boolean;
};

function createManagerHarness(storage: Map<string, unknown>): ManagerHarness {
  const manager: ManagerHarness = {
    adapters: new Map(),
    providerWriteSeq: {
      github: 0, google: 0, onedrive: 0, webdav: 0, s3: 0,
    },
    providerDecryptSeq: {
      github: 0, google: 0, onedrive: 0, webdav: 0, s3: 0,
    },
    providerDecrypted: {
      github: true, google: true, onedrive: true, webdav: true, s3: true,
    },
    providerAuthAttemptSeq: {
      github: 0, google: 0, onedrive: 0, webdav: 0, s3: 0,
    },
    providerAuthRestoreState: {
      github: null, google: null, onedrive: null, webdav: null, s3: null,
    },
    decryptionReady: Promise.resolve(),
    state: null,
    loadFromStorage<T>(key: string): T | null {
      return (storage.has(key) ? storage.get(key) : null) as T | null;
    },
    saveToStorage(key: string, value: unknown) {
      storage.set(key, value);
      return true;
    },
    removeFromStorage(key: string) {
      storage.delete(key);
    },
    loadProviderConnection(provider: CloudProvider) {
      return loadProviderConnectionImpl.call(manager, provider);
    },
    notifyStateChange() {},
    isActiveAuthAttempt() {
      return true;
    },
  };
  return manager;
}

describe('plugin provider manager boundary', () => {
  it('loads registered plugin providers into initial state and keeps them across restart', () => {
    const storage = memoryStorage();
    // Seed device identity so loadInitialStateImpl never touches browser globals.
    storage.set(SYNC_STORAGE_KEYS.DEVICE_ID, 'test-device');
    storage.set(SYNC_STORAGE_KEYS.DEVICE_NAME, 'Test Device');
    const manager = createManagerHarness(storage);
    registerPluginProviderIdImpl.call(manager, 'com.example.backup.sync');
    storage.set('netcatty_provider_plugin_v1:com.example.backup.sync', {
      provider: 'com.example.backup.sync',
      status: 'connected',
      config: { endpoint: 'https://example.test' },
    });

    const state = loadInitialStateImpl.call(manager);
    assert.ok(state.providers['com.example.backup.sync']);
    // Without the plugin host IPC surface, dynamic providers keep config but
    // must not join sync cycles as "connected".
    assert.equal(state.providers['com.example.backup.sync'].status, 'disconnected');
    assert.deepEqual(
      (state.providers['com.example.backup.sync'].config as { endpoint?: string })?.endpoint,
      'https://example.test',
    );
    assert.deepEqual(listRegisteredPluginProviderIdsImpl.call(manager), [
      'com.example.backup.sync',
    ]);
  });

  it('setAvailablePluginSyncProviderIds drops missing providers from the ready set', () => {
    const storage = memoryStorage();
    const manager = createManagerHarness(storage);
    manager.state = {
      providers: {
        'com.example.backup.sync': {
          provider: 'com.example.backup.sync',
          status: 'connected',
          config: { endpoint: 'https://example.test' },
        },
      },
    };
    manager.adapters = new Map();
    registerPluginProviderIdImpl.call(manager, 'com.example.backup.sync');
    assert.deepEqual(listAvailablePluginSyncProviderIdsImpl.call(manager), [
      'com.example.backup.sync',
    ]);
    // Plugin uninstalled / contribution gone.
    setAvailablePluginSyncProviderIdsImpl.call(manager, []);
    assert.deepEqual(listAvailablePluginSyncProviderIdsImpl.call(manager), []);
    assert.equal(manager.state.providers['com.example.backup.sync'].status, 'disconnected');
  });

  it('setAvailablePluginSyncProviderIds keeps adapters when availability membership is unchanged', () => {
    const storage = memoryStorage();
    const manager = createManagerHarness(storage);
    const pluginId = 'com.example.backup.sync';
    let signedOut = 0;
    manager.state = {
      providers: {
        [pluginId]: {
          provider: pluginId,
          status: 'connected',
          config: { endpoint: 'https://example.test' },
        },
      },
    };
    manager.adapters = new Map([
      [pluginId, {
        isAuthenticated: true,
        accountInfo: { id: 'acct' },
        resourceId: null,
        signOut() { signedOut += 1; },
        async initializeSync() { return null; },
        async upload() { return 'ok'; },
        async download() { return null; },
        async deleteSync() {},
        getTokens() { return null; },
      }],
    ]);
    registerPluginProviderIdImpl.call(manager, pluginId);
    // Same contribution still present (setting-updated noise).
    setAvailablePluginSyncProviderIdsImpl.call(manager, [pluginId]);
    assert.equal(manager.adapters.has(pluginId), true, 'must keep adapter on no-op membership refresh');
    assert.equal(signedOut, 0);
    assert.equal(manager.state.providers[pluginId].status, 'connected');
  });

  it('setAvailablePluginSyncProviderIds drops adapters when a provider re-enters the set', () => {
    const storage = memoryStorage();
    const manager = createManagerHarness(storage);
    const pluginId = 'com.example.backup.sync';
    let signedOut = 0;
    manager.state = {
      providers: {
        [pluginId]: {
          provider: pluginId,
          status: 'disconnected',
          config: { endpoint: 'https://example.test' },
          error: 'Plugin sync provider is no longer installed or enabled',
        },
      },
    };
    manager.adapters = new Map([
      [pluginId, {
        isAuthenticated: true,
        accountInfo: { id: 'acct' },
        resourceId: null,
        signOut() { signedOut += 1; },
        async initializeSync() { return null; },
        async upload() { return 'ok'; },
        async download() { return null; },
        async deleteSync() {},
        getTokens() { return null; },
      }],
    ]);
    // Not in available set yet.
    setAvailablePluginSyncProviderIdsImpl.call(manager, []);
    assert.equal(manager.adapters.has(pluginId), false);
    // Stale adapter reattached (should not happen in prod) then re-enter.
    manager.adapters.set(pluginId, {
      isAuthenticated: true,
      accountInfo: { id: 'acct' },
      resourceId: null,
      signOut() { signedOut += 1; },
      async initializeSync() { return null; },
      async upload() { return 'ok'; },
      async download() { return null; },
      async deleteSync() {},
      getTokens() { return null; },
    });
    setAvailablePluginSyncProviderIdsImpl.call(manager, [pluginId]);
    assert.equal(manager.adapters.has(pluginId), false, 'must drop adapter when provider re-enters');
    assert.equal(signedOut >= 1, true);
    assert.equal(manager.state.providers[pluginId].status, 'connected');
  });

  it('saveProviderConnection registers plugin IDs and disconnect unregisters them', async () => {
    const storage = memoryStorage();
    const manager = createManagerHarness(storage);
    manager.state = { providers: {} };

    const connection: ProviderConnection = {
      provider: 'com.example.backup.sync',
      status: 'connected',
      // Non-secret plugin config: encryptProviderSecrets is a no-op without bridge.
      config: { endpoint: 'https://example.test' } as never,
    };
    await saveProviderConnectionImpl.call(manager, 'com.example.backup.sync', connection);
    assert.deepEqual(
      storage.get(SYNC_STORAGE_KEYS.PLUGIN_CLOUD_PROVIDERS),
      ['com.example.backup.sync'],
    );
    assert.ok(storage.get('netcatty_provider_plugin_v1:com.example.backup.sync'));

    unregisterPluginProviderIdImpl.call(manager, 'com.example.backup.sync');
    assert.equal(storage.has(SYNC_STORAGE_KEYS.PLUGIN_CLOUD_PROVIDERS), false);
  });

  it('getConnectedAdapter uses createPluginStorage for namespaced provider IDs', async () => {
    const storage = memoryStorage();
    const manager = createManagerHarness(storage);
    const pluginId = 'com.example.backup.sync';
    const objectStore = new Map<string, Uint8Array>();
    let factoryCalls = 0;

    manager.state = {
      providers: {
        [pluginId]: {
          provider: pluginId,
          status: 'connected',
          config: { endpoint: 'https://example.test' },
        },
      },
    };
    manager.providerDecrypted[pluginId] = true;
    manager.createPluginStorage = async (id: string): Promise<EncryptedObjectStorage> => {
      factoryCalls += 1;
      assert.equal(id, pluginId);
      return {
        providerId: id,
        async connect() {
          return { account: { id: 'plugin-acct' } };
        },
        async disconnect() {},
        async getAccount() {
          return { account: { id: 'plugin-acct' } };
        },
        async getCapabilities() {
          return {
            revisions: true,
            conditionalWrites: true,
            atomicReplacement: true,
          };
        },
        async readObject(key: string) {
          const bytes = objectStore.get(key) ?? null;
          return bytes
            ? { found: true, key, bytes, revision: '1' }
            : { found: false, key, bytes: null };
        },
        async writeObject(key: string, bytes: Uint8Array) {
          const created = !objectStore.has(key);
          objectStore.set(key, bytes);
          return { created, revision: '2' };
        },
        async deleteObject(key: string) {
          return { deleted: objectStore.delete(key) };
        },
      };
    };

    const adapter = await getConnectedAdapterImpl.call(manager, pluginId);
    assert.equal(factoryCalls, 1);
    // Config-backed plugin connections report authenticated for cache reuse.
    assert.equal(adapter.isAuthenticated, true);
    const reused = await getConnectedAdapterImpl.call(manager, pluginId);
    assert.equal(reused, adapter);
    assert.equal(factoryCalls, 1, 'must not recreate when cached adapter is authenticated');

    await adapter.initializeSync();
    assert.equal(adapter.accountInfo?.id, 'plugin-acct');

    const file = makeSyncedFile(7, 'plugin-cipher');
    await adapter.upload(file);
    const downloaded = await adapter.download();
    assert.equal(downloaded?.payload, 'plugin-cipher');
    assert.equal(downloaded?.meta.version, 7);
    assert.ok(objectStore.has(DEFAULT_ENCRYPTED_SYNC_OBJECT_KEY));
  });

  it('getConnectedAdapter accepts falsy scalar plugin configs as present', async () => {
    for (const scalar of [false, 0, ''] as const) {
      const storage = memoryStorage();
      const manager = createManagerHarness(storage);
      const pluginId = 'com.example.scalar.sync';
      let factoryCalls = 0;
      manager.state = {
        providers: {
          [pluginId]: {
            provider: pluginId,
            status: 'connected',
            config: scalar as never,
          },
        },
      };
      manager.providerDecrypted[pluginId] = true;
      manager.createPluginStorage = async (id: string): Promise<EncryptedObjectStorage> => {
        factoryCalls += 1;
        assert.equal(id, pluginId);
        return {
          providerId: id,
          async connect() {
            return { account: { id: 'scalar-acct' } };
          },
          async disconnect() {},
          async getAccount() {
            return { account: { id: 'scalar-acct' } };
          },
          async getCapabilities() {
            return {
              revisions: false,
              conditionalWrites: false,
              atomicReplacement: true,
            };
          },
          async readObject() {
            return { found: false, key: 'x', bytes: null };
          },
          async writeObject() {
            return { created: true, revision: '1' };
          },
          async deleteObject() {
            return { deleted: false };
          },
        };
      };

      const adapter = await getConnectedAdapterImpl.call(manager, pluginId);
      assert.equal(factoryCalls, 1);
      assert.equal(adapter.isAuthenticated, true);
    }

    const empty = createManagerHarness(memoryStorage());
    empty.state = {
      providers: {
        'com.example.empty.sync': {
          provider: 'com.example.empty.sync',
          status: 'connected',
        },
      },
    };
    empty.providerDecrypted['com.example.empty.sync'] = true;
    await assert.rejects(
      () => getConnectedAdapterImpl.call(empty, 'com.example.empty.sync'),
      /Provider not connected/,
    );
  });
});

describe('createAdapter WebDAV production path', () => {
  it('returns an authenticated adapter and reuses it via getConnectedAdapter cache semantics', async () => {
    const storage = memoryStorage();
    const manager = createManagerHarness(storage);
    manager.state = {
      providers: {
        webdav: {
          provider: 'webdav',
          status: 'connected',
          config: {
            endpoint: 'https://webdav.example.test',
            authType: 'basic',
            username: 'user',
            password: 'secret',
          },
          resourceId: '/netcatty-vault.json',
        },
      },
    };
    manager.providerDecrypted.webdav = true;

    const a1 = await getConnectedAdapterImpl.call(manager, 'webdav');
    assert.equal(a1.isAuthenticated, true);
    assert.equal(a1.resourceId, '/netcatty-vault.json');
    const a2 = await getConnectedAdapterImpl.call(manager, 'webdav');
    assert.equal(a1, a2, 'must reuse cached adapter when isAuthenticated is true');
  });

  it('enforceLegacySingleProviderConnected keeps builtin and disconnects plugin', () => {
    const providers: Record<string, ProviderConnection> = {
      github: { provider: 'github', status: 'connected' },
      'com.example.backup.sync': {
        provider: 'com.example.backup.sync',
        status: 'connected',
        config: { endpoint: 'https://example.test' },
      },
    };
    enforceLegacySingleProviderConnected(providers);
    assert.equal(providers.github?.status, 'connected');
    assert.equal(providers['com.example.backup.sync']?.status, 'disconnected');
    assert.deepEqual(
      providers['com.example.backup.sync']?.config,
      { endpoint: 'https://example.test' },
    );
  });
});
