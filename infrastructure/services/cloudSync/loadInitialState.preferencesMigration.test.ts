import test from 'node:test';
import assert from 'node:assert/strict';

import { SYNC_STORAGE_KEYS } from '../../../domain/sync.ts';
import { loadInitialStateImpl, loadProviderConnectionImpl } from './stateAndSecurityMethods.ts';

test('startup does not eagerly write SYNC_PREFERENCES over a concurrent autoSync=false', () => {
  const storage = new Map<string, unknown>();
  storage.set(SYNC_STORAGE_KEYS.DEVICE_ID, 'test-device');
  storage.set(SYNC_STORAGE_KEYS.DEVICE_NAME, 'Test Device');
  // Legacy combined blob from pre-split builds.
  storage.set(SYNC_STORAGE_KEYS.SYNC_CONFIG, {
    autoSync: true,
    interval: 5,
    syncStrategy: 'smartMerge',
    localVersion: 2,
    localUpdatedAt: 100,
    remoteVersion: 2,
    remoteUpdatedAt: 100,
  });

  let preferenceReads = 0;
  const manager = {
    providerWriteSeq: {} as Record<string, number>,
    providerDecryptSeq: {} as Record<string, number>,
    providerDecrypted: {} as Record<string, boolean>,
    providerAuthAttemptSeq: {} as Record<string, number>,
    providerAuthRestoreState: {} as Record<string, unknown>,
    loadFromStorage(key: string) {
      if (key === SYNC_STORAGE_KEYS.SYNC_PREFERENCES) {
        preferenceReads += 1;
        // Concurrent window already wrote autoSync=false before this
        // process's preference read.
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
      return true;
    },
    loadProviderConnection(provider: string) {
      return loadProviderConnectionImpl.call(this, provider);
    },
  };

  const state = loadInitialStateImpl.call(manager);

  assert.equal(
    storage.has(SYNC_STORAGE_KEYS.SYNC_PREFERENCES),
    false,
    'must not eagerly write SYNC_PREFERENCES on startup',
  );
  assert.equal(preferenceReads, 1);
  assert.equal(state.autoSyncEnabled, false);
});

test('startup adopts legacy SYNC_CONFIG prefs without writing SYNC_PREFERENCES', () => {
  const storage = new Map<string, unknown>();
  storage.set(SYNC_STORAGE_KEYS.DEVICE_ID, 'test-device');
  storage.set(SYNC_STORAGE_KEYS.DEVICE_NAME, 'Test Device');
  storage.set(SYNC_STORAGE_KEYS.SYNC_CONFIG, {
    autoSync: true,
    interval: 15,
    syncStrategy: 'preferCloud',
    localVersion: 1,
    localUpdatedAt: 1,
    remoteVersion: 1,
    remoteUpdatedAt: 1,
  });

  const manager = {
    providerWriteSeq: {} as Record<string, number>,
    providerDecryptSeq: {} as Record<string, number>,
    providerDecrypted: {} as Record<string, boolean>,
    providerAuthAttemptSeq: {} as Record<string, number>,
    providerAuthRestoreState: {} as Record<string, unknown>,
    loadFromStorage(key: string) {
      return storage.get(key) ?? null;
    },
    saveToStorage(key: string, value: unknown) {
      storage.set(key, value);
      return true;
    },
    loadProviderConnection(provider: string) {
      return loadProviderConnectionImpl.call(this, provider);
    },
  };

  const state = loadInitialStateImpl.call(manager);

  assert.equal(
    storage.has(SYNC_STORAGE_KEYS.SYNC_PREFERENCES),
    false,
    'startup must not eagerly migrate preferences to disk',
  );
  assert.equal(state.autoSyncEnabled, true);
  assert.equal(state.autoSyncInterval, 15);
  assert.equal(state.syncStrategy, 'preferCloud');
});
