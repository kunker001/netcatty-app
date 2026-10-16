import test from 'node:test';
import assert from 'node:assert/strict';

import { SYNC_STORAGE_KEYS } from '../../../domain/sync.ts';
import { saveSyncConfigImpl, setAutoSyncImpl } from './syncAllStorageMethods.ts';

test('version saveSyncConfig does not clobber another window autoSync=false', () => {
  const storage = new Map<string, unknown>();
  storage.set(SYNC_STORAGE_KEYS.SYNC_PREFERENCES, {
    autoSync: false,
    interval: 5,
    syncStrategy: 'smartMerge',
  });
  storage.set(SYNC_STORAGE_KEYS.SYNC_CONFIG, {
    localVersion: 3,
    localUpdatedAt: 100,
    remoteVersion: 3,
    remoteUpdatedAt: 100,
  });

  let stopCount = 0;
  const manager = {
    state: {
      autoSyncEnabled: true, // stale — this window has not observed the other window yet
      autoSyncInterval: 5,
      localVersion: 4,
      localUpdatedAt: 200,
      remoteVersion: 4,
      remoteUpdatedAt: 200,
      syncStrategy: 'smartMerge',
      securityState: 'UNLOCKED',
    },
    loadFromStorage(key: string) {
      return storage.get(key) ?? null;
    },
    saveToStorage(key: string, value: unknown) {
      storage.set(key, value);
      return true;
    },
    saveSyncConfig() {
      saveSyncConfigImpl.call(this);
    },
    notifyStateChange() {},
    startAutoSync() {},
    stopAutoSync() {
      stopCount += 1;
    },
  };

  // Simulate post-upload version bump save (default: preferences from storage)
  saveSyncConfigImpl.call(manager);

  const savedConfig = storage.get(SYNC_STORAGE_KEYS.SYNC_CONFIG) as {
    autoSync?: boolean;
    localVersion: number;
  };
  const savedPrefs = storage.get(SYNC_STORAGE_KEYS.SYNC_PREFERENCES) as { autoSync: boolean };
  assert.equal(savedPrefs.autoSync, false, 'must not re-enable auto-sync from stale memory');
  assert.equal(savedConfig.autoSync, undefined, 'version blob must omit preference fields');
  assert.equal(savedConfig.localVersion, 4);
  assert.equal(manager.state.autoSyncEnabled, false, 'memory should adopt storage preference');
  assert.equal(stopCount, 1);
});

test('version save after mid-flight preference toggle keeps autoSync=false', () => {
  const storage = new Map<string, unknown>();
  storage.set(SYNC_STORAGE_KEYS.SYNC_PREFERENCES, {
    autoSync: true,
    interval: 5,
    syncStrategy: 'smartMerge',
  });
  storage.set(SYNC_STORAGE_KEYS.SYNC_CONFIG, {
    localVersion: 3,
    localUpdatedAt: 100,
    remoteVersion: 3,
    remoteUpdatedAt: 100,
  });

  let preferenceReads = 0;
  const manager = {
    state: {
      autoSyncEnabled: true,
      autoSyncInterval: 5,
      localVersion: 4,
      localUpdatedAt: 200,
      remoteVersion: 4,
      remoteUpdatedAt: 200,
      syncStrategy: 'smartMerge',
      securityState: 'UNLOCKED',
    },
    loadFromStorage(key: string) {
      if (key === SYNC_STORAGE_KEYS.SYNC_PREFERENCES) {
        preferenceReads += 1;
        // First existence check still sees autoSync=true; a Settings toggle
        // lands before the post-write re-read used for memory adoption.
        if (preferenceReads === 1) {
          return storage.get(key) ?? null;
        }
        return {
          autoSync: false,
          interval: 5,
          syncStrategy: 'smartMerge',
        };
      }
      return storage.get(key) ?? null;
    },
    saveToStorage(key: string, value: unknown) {
      storage.set(key, value);
      // Concurrent Settings window disables auto-sync while versions persist.
      if (key === SYNC_STORAGE_KEYS.SYNC_CONFIG) {
        storage.set(SYNC_STORAGE_KEYS.SYNC_PREFERENCES, {
          autoSync: false,
          interval: 5,
          syncStrategy: 'smartMerge',
        });
      }
      return true;
    },
    notifyStateChange() {},
    startAutoSync() {},
    stopAutoSync() {},
  };

  saveSyncConfigImpl.call(manager);

  const savedPrefs = storage.get(SYNC_STORAGE_KEYS.SYNC_PREFERENCES) as { autoSync: boolean };
  const savedConfig = storage.get(SYNC_STORAGE_KEYS.SYNC_CONFIG) as { autoSync?: boolean };
  assert.equal(savedPrefs.autoSync, false);
  assert.equal(savedConfig.autoSync, undefined);
  assert.equal(manager.state.autoSyncEnabled, false);
});

test('setAutoSync still persists the explicit preference from memory', () => {
  const storage = new Map<string, unknown>();
  storage.set(SYNC_STORAGE_KEYS.SYNC_CONFIG, {
    localVersion: 1,
    localUpdatedAt: 1,
    remoteVersion: 1,
    remoteUpdatedAt: 1,
  });
  storage.set(SYNC_STORAGE_KEYS.SYNC_PREFERENCES, {
    autoSync: true,
    interval: 5,
    syncStrategy: 'smartMerge',
  });

  const manager = {
    state: {
      autoSyncEnabled: true,
      autoSyncInterval: 5,
      localVersion: 1,
      localUpdatedAt: 1,
      remoteVersion: 1,
      remoteUpdatedAt: 1,
      syncStrategy: 'smartMerge',
      securityState: 'UNLOCKED',
    },
    loadFromStorage(key: string) {
      return storage.get(key) ?? null;
    },
    saveToStorage(key: string, value: unknown) {
      storage.set(key, value);
      return true;
    },
    saveSyncConfig(opts?: {
      preferencesFromMemory?: boolean;
      memoryKeys?: ReadonlyArray<'autoSync' | 'interval' | 'syncStrategy'>;
    }) {
      saveSyncConfigImpl.call(this, opts);
    },
    notifyStateChange() {},
    startAutoSync() {},
    stopAutoSync() {},
  };

  setAutoSyncImpl.call(manager, false);

  const savedPrefs = storage.get(SYNC_STORAGE_KEYS.SYNC_PREFERENCES) as { autoSync: boolean };
  const savedConfig = storage.get(SYNC_STORAGE_KEYS.SYNC_CONFIG) as { autoSync?: boolean };
  assert.equal(savedPrefs.autoSync, false);
  assert.equal(savedConfig.autoSync, undefined);
  assert.equal(manager.state.autoSyncEnabled, false);
});

test('strategy preference write does not re-enable stale autoSync from memory', () => {
  const storage = new Map<string, unknown>();
  storage.set(SYNC_STORAGE_KEYS.SYNC_PREFERENCES, {
    autoSync: false,
    interval: 15,
    syncStrategy: 'smartMerge',
  });
  storage.set(SYNC_STORAGE_KEYS.SYNC_CONFIG, {
    localVersion: 2,
    localUpdatedAt: 20,
    remoteVersion: 2,
    remoteUpdatedAt: 20,
  });

  const manager = {
    state: {
      // Stale: another window already disabled auto-sync in storage.
      autoSyncEnabled: true,
      autoSyncInterval: 5,
      localVersion: 2,
      localUpdatedAt: 20,
      remoteVersion: 2,
      remoteUpdatedAt: 20,
      syncStrategy: 'preferLocal',
      securityState: 'UNLOCKED',
    },
    loadFromStorage(key: string) {
      return storage.get(key) ?? null;
    },
    saveToStorage(key: string, value: unknown) {
      storage.set(key, value);
      return true;
    },
    saveSyncConfig(opts?: {
      preferencesFromMemory?: boolean;
      memoryKeys?: ReadonlyArray<'autoSync' | 'interval' | 'syncStrategy'>;
    }) {
      saveSyncConfigImpl.call(this, opts);
    },
    notifyStateChange() {},
    startAutoSync() {},
    stopAutoSync() {},
  };

  saveSyncConfigImpl.call(manager, {
    preferencesFromMemory: true,
    memoryKeys: ['syncStrategy'],
  });

  const savedPrefs = storage.get(SYNC_STORAGE_KEYS.SYNC_PREFERENCES) as {
    autoSync: boolean;
    interval: number;
    syncStrategy: string;
  };
  assert.equal(savedPrefs.autoSync, false);
  assert.equal(savedPrefs.interval, 15);
  assert.equal(savedPrefs.syncStrategy, 'preferLocal');
});

function createPersistHarness(storage: Map<string, unknown>, state: {
  autoSyncEnabled: boolean;
  autoSyncInterval: number;
  localVersion: number;
  localUpdatedAt: number;
  remoteVersion: number;
  remoteUpdatedAt: number;
  syncStrategy: string;
  securityState?: string;
}) {
  return {
    state: {
      securityState: 'UNLOCKED',
      ...state,
    },
    loadFromStorage(key: string) {
      return storage.get(key) ?? null;
    },
    saveToStorage(key: string, value: unknown) {
      storage.set(key, value);
      return true;
    },
    saveSyncConfig(opts?: {
      preferencesFromMemory?: boolean;
      memoryKeys?: ReadonlyArray<'autoSync' | 'interval' | 'syncStrategy'>;
    }) {
      saveSyncConfigImpl.call(this, opts);
    },
    notifyStateChange() {},
    startAutoSync() {},
    stopAutoSync() {},
  };
}

test('version-only save does not create SYNC_PREFERENCES during first upgrade', () => {
  const storage = new Map<string, unknown>();
  storage.set(SYNC_STORAGE_KEYS.SYNC_CONFIG, {
    autoSync: true,
    interval: 15,
    syncStrategy: 'preferCloud',
    localVersion: 3,
    localUpdatedAt: 100,
    remoteVersion: 3,
    remoteUpdatedAt: 100,
  });

  const manager = createPersistHarness(storage, {
    autoSyncEnabled: true,
    autoSyncInterval: 15,
    localVersion: 4,
    localUpdatedAt: 200,
    remoteVersion: 4,
    remoteUpdatedAt: 200,
    syncStrategy: 'preferCloud',
  });

  saveSyncConfigImpl.call(manager);

  assert.equal(storage.has(SYNC_STORAGE_KEYS.SYNC_PREFERENCES), false);
  const savedConfig = storage.get(SYNC_STORAGE_KEYS.SYNC_CONFIG) as {
    autoSync?: boolean;
    interval?: number;
    syncStrategy?: string;
    localVersion: number;
  };
  assert.equal(savedConfig.autoSync, true);
  assert.equal(savedConfig.interval, 15);
  assert.equal(savedConfig.syncStrategy, 'preferCloud');
  assert.equal(savedConfig.localVersion, 4);
});

test('version-only save preserves stored legacy autoSync=false over stale memory', () => {
  const storage = new Map<string, unknown>();
  storage.set(SYNC_STORAGE_KEYS.SYNC_CONFIG, {
    autoSync: false,
    interval: 5,
    syncStrategy: 'smartMerge',
    localVersion: 3,
    localUpdatedAt: 100,
    remoteVersion: 3,
    remoteUpdatedAt: 100,
  });

  const manager = createPersistHarness(storage, {
    autoSyncEnabled: true,
    autoSyncInterval: 5,
    localVersion: 4,
    localUpdatedAt: 200,
    remoteVersion: 4,
    remoteUpdatedAt: 200,
    syncStrategy: 'smartMerge',
  });

  saveSyncConfigImpl.call(manager);

  assert.equal(storage.has(SYNC_STORAGE_KEYS.SYNC_PREFERENCES), false);
  const savedConfig = storage.get(SYNC_STORAGE_KEYS.SYNC_CONFIG) as { autoSync?: boolean };
  assert.equal(savedConfig.autoSync, false);
  assert.equal(manager.state.autoSyncEnabled, false);
});

test('version-only save cannot overwrite a concurrent first-upgrade autoSync=false', () => {
  const storage = new Map<string, unknown>();
  storage.set(SYNC_STORAGE_KEYS.SYNC_CONFIG, {
    autoSync: true,
    interval: 5,
    syncStrategy: 'smartMerge',
    localVersion: 3,
    localUpdatedAt: 100,
    remoteVersion: 3,
    remoteUpdatedAt: 100,
  });

  let preferenceReads = 0;
  const manager = {
    ...createPersistHarness(storage, {
      autoSyncEnabled: true,
      autoSyncInterval: 5,
      localVersion: 4,
      localUpdatedAt: 200,
      remoteVersion: 4,
      remoteUpdatedAt: 200,
      syncStrategy: 'smartMerge',
    }),
    loadFromStorage(key: string) {
      if (key === SYNC_STORAGE_KEYS.SYNC_PREFERENCES) {
        preferenceReads += 1;
        // Settings toggle lands after the existence check and before the
        // post-write reread — the previous migrate wrote stale autoSync=true
        // into this key and clobbered the toggle.
        if (preferenceReads === 1) return null;
        return storage.get(key) ?? null;
      }
      return storage.get(key) ?? null;
    },
    saveToStorage(key: string, value: unknown) {
      storage.set(key, value);
      if (key === SYNC_STORAGE_KEYS.SYNC_CONFIG) {
        storage.set(SYNC_STORAGE_KEYS.SYNC_PREFERENCES, {
          autoSync: false,
          interval: 5,
          syncStrategy: 'smartMerge',
        });
      }
      return true;
    },
  };

  saveSyncConfigImpl.call(manager);

  const savedPrefs = storage.get(SYNC_STORAGE_KEYS.SYNC_PREFERENCES) as { autoSync: boolean };
  assert.equal(savedPrefs.autoSync, false, 'must not migrate stale autoSync=true over a concurrent toggle');
  assert.equal(manager.state.autoSyncEnabled, false);
});

test('first-upgrade setAutoSync(false) then version save does not re-enable', () => {
  const storage = new Map<string, unknown>();
  storage.set(SYNC_STORAGE_KEYS.SYNC_CONFIG, {
    autoSync: true,
    interval: 5,
    syncStrategy: 'smartMerge',
    localVersion: 3,
    localUpdatedAt: 100,
    remoteVersion: 3,
    remoteUpdatedAt: 100,
  });

  const manager = createPersistHarness(storage, {
    autoSyncEnabled: true,
    autoSyncInterval: 5,
    localVersion: 3,
    localUpdatedAt: 100,
    remoteVersion: 3,
    remoteUpdatedAt: 100,
    syncStrategy: 'smartMerge',
  });

  setAutoSyncImpl.call(manager, false);
  manager.state.localVersion = 4;
  manager.state.localUpdatedAt = 200;
  saveSyncConfigImpl.call(manager);

  const savedPrefs = storage.get(SYNC_STORAGE_KEYS.SYNC_PREFERENCES) as { autoSync: boolean };
  const savedConfig = storage.get(SYNC_STORAGE_KEYS.SYNC_CONFIG) as {
    autoSync?: boolean;
    localVersion: number;
  };
  assert.equal(savedPrefs.autoSync, false);
  assert.equal(savedConfig.autoSync, undefined);
  assert.equal(savedConfig.localVersion, 4);
  assert.equal(manager.state.autoSyncEnabled, false);
});
