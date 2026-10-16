import test from 'node:test';
import assert from 'node:assert/strict';

type LocalStorageMock = {
  clear(): void;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function installLocalStorage(): LocalStorageMock {
  const store = new Map<string, string>();
  const localStorage: LocalStorageMock = {
    clear() { store.clear(); },
    getItem(key) { return store.has(key) ? store.get(key)! : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorage,
    configurable: true,
  });
  return localStorage;
}

const localStorage = installLocalStorage();

const { SYNC_STORAGE_KEYS } = await import('../domain/sync.ts');
const { localStorageAdapter } = await import('../infrastructure/persistence/localStorageAdapter.ts');
const {
  collectPluginSyncSidecarsFromHost,
  commitPluginSidecarsLastKnown,
  isPluginSidecarHostReady,
} = await import('./pluginSyncSidecarBridge.ts');
const { hasMeaningfulCloudSyncData } = await import('./syncPayload.ts');

test.beforeEach(() => {
  localStorage.clear();
  delete (globalThis as { window?: unknown }).window;
});

test('isPluginSidecarHostReady follows pluginHostReady probe when present', () => {
  (globalThis as { window: unknown }).window = {
    netcatty: {
      pluginHostReady: () => true,
      async collectPluginSyncSidecars() {
        return { version: 1, entries: [] };
      },
    },
  };
  assert.equal(isPluginSidecarHostReady(), true);

  (globalThis as { window: unknown }).window = {
    netcatty: {
      pluginHostReady: () => false,
      async collectPluginSyncSidecars() {
        return null;
      },
    },
  };
  assert.equal(isPluginSidecarHostReady(), false);
});

test('collect defers empty last-known until commit (empty-vault guard ignores last-known alone)', async () => {
  localStorageAdapter.write(SYNC_STORAGE_KEYS.PLUGIN_SIDECARS_LAST_KNOWN, {
    version: 1,
    entries: [{
      pluginId: 'com.example.p',
      kind: 'settings',
      key: 'k',
      value: 1,
      updatedAt: 1,
    }],
  });
  (globalThis as { window: unknown }).window = {
    netcatty: {
      async collectPluginSyncSidecars() {
        return { version: 1, entries: [] };
      },
    },
  };

  const collected = await collectPluginSyncSidecarsFromHost();
  assert.deepEqual(collected, { version: 1, entries: [] });

  // Last-known still holds prior entries until commit, but that alone must not
  // bypass the empty-vault upload guard.
  const lastKnown = localStorageAdapter.read<{ entries: unknown[] }>(
    SYNC_STORAGE_KEYS.PLUGIN_SIDECARS_LAST_KNOWN,
  );
  assert.equal(lastKnown?.entries?.length, 1);

  assert.equal(
    hasMeaningfulCloudSyncData({
      hosts: [],
      keys: [],
      identities: [],
      snippets: [],
      customGroups: [],
      syncedAt: 1,
      pluginSidecars: { version: 1, entries: [] },
    }),
    false,
  );

  commitPluginSidecarsLastKnown({ version: 1, entries: [] });
  const committed = localStorageAdapter.read<{ entries: unknown[] }>(
    SYNC_STORAGE_KEYS.PLUGIN_SIDECARS_LAST_KNOWN,
  );
  assert.deepEqual(committed?.entries, []);
});

test('liveOnly collect returns null instead of last-known when host is gated off', async () => {
  localStorageAdapter.write(SYNC_STORAGE_KEYS.PLUGIN_SIDECARS_LAST_KNOWN, {
    version: 1,
    entries: [{
      pluginId: 'com.example.p',
      kind: 'settings',
      key: 'k',
      value: 1,
      updatedAt: 1,
    }],
  });
  (globalThis as { window: unknown }).window = {
    netcatty: {
      async collectPluginSyncSidecars() {
        return null;
      },
    },
  };

  assert.equal(await collectPluginSyncSidecarsFromHost({ liveOnly: true }), null);
  const fallback = await collectPluginSyncSidecarsFromHost();
  assert.equal(fallback?.entries?.length, 1);
});

test('liveOnly collect omits pending remote when replay cannot apply', async () => {
  localStorageAdapter.write(SYNC_STORAGE_KEYS.PLUGIN_SIDECARS_PENDING_REMOTE, {
    version: 1,
    entries: [{
      pluginId: 'com.example.remote',
      kind: 'settings',
      key: 'k',
      value: 'remote',
      updatedAt: 2,
    }],
  });
  (globalThis as { window: unknown }).window = {
    netcatty: {
      async collectPluginSyncSidecars() {
        return { version: 1, entries: [] };
      },
      // no applyPluginSyncSidecars → pending cannot replay
    },
  };

  assert.equal(await collectPluginSyncSidecarsFromHost({ liveOnly: true }), null);
  const uploadPath = await collectPluginSyncSidecarsFromHost();
  assert.equal(uploadPath?.entries?.[0]?.value, 'remote');
});

test('commitPluginSidecarsAfterSuccessfulSync prefers merged payload sidecars', async () => {
  const { commitPluginSidecarsAfterSuccessfulSync } = await import('./pluginSyncSidecarBridge.ts');
  localStorageAdapter.write(SYNC_STORAGE_KEYS.PLUGIN_SIDECARS_LAST_KNOWN, {
    version: 1,
    entries: [{
      pluginId: 'com.example.old',
      kind: 'settings',
      key: 'k',
      value: 'old',
      updatedAt: 1,
    }],
  });

  commitPluginSidecarsAfterSuccessfulSync(
    {
      pluginSidecars: {
        version: 1,
        entries: [{
          pluginId: 'com.example.local',
          kind: 'settings',
          key: 'k',
          value: 'local',
          updatedAt: 2,
        }],
      },
    },
    [{
      success: true,
      mergedPayload: {
        pluginSidecars: {
          version: 1,
          entries: [{
            pluginId: 'com.example.merged',
            kind: 'settings',
            key: 'k',
            value: 'merged',
            updatedAt: 3,
          }],
        },
      },
    }],
  );

  const committed = localStorageAdapter.read<{ entries: Array<{ value: string }> }>(
    SYNC_STORAGE_KEYS.PLUGIN_SIDECARS_LAST_KNOWN,
  );
  assert.equal(committed?.entries?.[0]?.value, 'merged');
});
