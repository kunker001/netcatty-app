import test from 'node:test';
import assert from 'node:assert/strict';

import {
  coalesceStoredSyncPreferences,
  hasSyncPreferenceFields,
  resolveSyncConfigForPersist,
  resolveSyncPreferencesForPersist,
  resolveSyncVersionsForPersist,
} from './syncConfigPersist.ts';

const memoryBase = {
  autoSync: true,
  interval: 5,
  localVersion: 12,
  localUpdatedAt: 1000,
  remoteVersion: 11,
  remoteUpdatedAt: 900,
  syncStrategy: 'smartMerge' as const,
};

test('version-only persist keeps another window autoSync=false from storage', () => {
  const next = resolveSyncConfigForPersist({
    memory: memoryBase,
    stored: {
      autoSync: false,
      interval: 5,
      localVersion: 10,
      localUpdatedAt: 800,
      remoteVersion: 10,
      remoteUpdatedAt: 800,
      syncStrategy: 'smartMerge',
    },
    preferencesFromMemory: false,
  });

  assert.equal(next.autoSync, false);
  assert.equal(next.localVersion, 12);
  assert.equal(next.remoteVersion, 11);
});

test('explicit preference persist writes memory autoSync', () => {
  const next = resolveSyncConfigForPersist({
    memory: { ...memoryBase, autoSync: false },
    stored: {
      autoSync: true,
      interval: 5,
      localVersion: 10,
      localUpdatedAt: 800,
      remoteVersion: 10,
      remoteUpdatedAt: 800,
      syncStrategy: 'smartMerge',
    },
    preferencesFromMemory: true,
  });

  assert.equal(next.autoSync, false);
  assert.equal(next.localVersion, 12);
});

test('strategy-only preference persist keeps stored autoSync', () => {
  const next = resolveSyncPreferencesForPersist({
    memory: {
      autoSync: true,
      interval: 5,
      syncStrategy: 'preferLocal',
    },
    stored: {
      autoSync: false,
      interval: 15,
      syncStrategy: 'smartMerge',
    },
    preferencesFromMemory: true,
    memoryKeys: ['syncStrategy'],
  });

  assert.equal(next.autoSync, false);
  assert.equal(next.interval, 15);
  assert.equal(next.syncStrategy, 'preferLocal');
});

test('autoSync-only preference persist keeps stored syncStrategy', () => {
  const next = resolveSyncPreferencesForPersist({
    memory: {
      autoSync: false,
      interval: 5,
      syncStrategy: 'smartMerge',
    },
    stored: {
      autoSync: true,
      interval: 15,
      syncStrategy: 'preferCloud',
    },
    preferencesFromMemory: true,
    memoryKeys: ['autoSync'],
  });

  assert.equal(next.autoSync, false);
  assert.equal(next.interval, 15);
  assert.equal(next.syncStrategy, 'preferCloud');
});

test('version-only persist keeps stored syncStrategy when memory differs', () => {
  const next = resolveSyncConfigForPersist({
    memory: { ...memoryBase, syncStrategy: 'preferLocal' },
    stored: {
      autoSync: false,
      interval: 15,
      syncStrategy: 'preferCloud',
    },
  });

  assert.equal(next.autoSync, false);
  assert.equal(next.interval, 15);
  assert.equal(next.syncStrategy, 'preferCloud');
});

test('coalesce prefers dedicated preferences over legacy SYNC_CONFIG fields', () => {
  const coalesced = coalesceStoredSyncPreferences(
    { autoSync: false, interval: 15, syncStrategy: 'preferCloud' },
    { autoSync: true, interval: 5, syncStrategy: 'smartMerge' },
  );
  assert.equal(coalesced?.autoSync, false);
  assert.equal(coalesced?.interval, 15);
});

test('hasSyncPreferenceFields ignores version-only blobs', () => {
  assert.equal(hasSyncPreferenceFields(null), false);
  assert.equal(hasSyncPreferenceFields({}), false);
  assert.equal(hasSyncPreferenceFields({ autoSync: false }), true);
  assert.equal(hasSyncPreferenceFields({ interval: 15 }), true);
  assert.equal(hasSyncPreferenceFields({ syncStrategy: 'preferCloud' }), true);
});

test('preference and version resolvers stay independent', () => {
  const prefs = resolveSyncPreferencesForPersist({
    memory: { autoSync: true, interval: 5, syncStrategy: 'smartMerge' },
    stored: { autoSync: false, interval: 15, syncStrategy: 'preferCloud' },
    preferencesFromMemory: false,
  });
  const versions = resolveSyncVersionsForPersist({
    localVersion: 9,
    localUpdatedAt: 1,
    remoteVersion: 8,
    remoteUpdatedAt: 2,
  });
  assert.equal(prefs.autoSync, false);
  assert.equal(versions.localVersion, 9);
  assert.equal('localVersion' in prefs, false);
  assert.equal('autoSync' in versions, false);
});
