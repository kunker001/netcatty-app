import assert from 'node:assert/strict';
import test from 'node:test';

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  },
});

const {
  clearConvergentSyncLocalConfigAfterDowngrade,
  getConvergentSyncLocalConfig,
  markConvergentSyncInitialized,
  pauseConvergentSync,
  refreshConvergentSyncLocalConfigSnapshot,
  subscribeConvergentSyncLocalConfig,
} = await import('./convergentSyncConfig.ts');

test.beforeEach(() => {
  values.clear();
  refreshConvergentSyncLocalConfigSnapshot();
});

test('pausing an initialized replica preserves its initialized metadata', () => {
  markConvergentSyncInitialized();
  assert.deepEqual(pauseConvergentSync(), { enabled: false, initialized: true });
  assert.deepEqual(getConvergentSyncLocalConfig(), { enabled: false, initialized: true });
});

test('downgrade state cannot be cleared without explicit confirmation', () => {
  markConvergentSyncInitialized();
  assert.throws(
    () => clearConvergentSyncLocalConfigAfterDowngrade(false),
    /Explicit confirmation/,
  );
  assert.deepEqual(getConvergentSyncLocalConfig(), { enabled: true, initialized: true });
  clearConvergentSyncLocalConfigAfterDowngrade(true);
  assert.deepEqual(getConvergentSyncLocalConfig(), { enabled: false, initialized: false });
});

test('config changes notify every hook instance through the shared store', () => {
  const snapshots: Array<{ enabled: boolean; initialized: boolean }> = [];
  const unsubscribeFirst = subscribeConvergentSyncLocalConfig(() => {
    snapshots.push(getConvergentSyncLocalConfig());
  });
  const unsubscribeSecond = subscribeConvergentSyncLocalConfig(() => {
    snapshots.push(getConvergentSyncLocalConfig());
  });

  markConvergentSyncInitialized();
  pauseConvergentSync();

  assert.deepEqual(snapshots, [
    { enabled: true, initialized: true },
    { enabled: true, initialized: true },
    { enabled: false, initialized: true },
    { enabled: false, initialized: true },
  ]);

  unsubscribeFirst();
  unsubscribeSecond();
});
