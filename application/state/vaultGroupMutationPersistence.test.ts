import assert from 'node:assert/strict';
import test from 'node:test';

import type { Host, Snippet } from '../../domain/models';
import {
  remapSnippetTargetGroupPaths,
  removeSnippetTargetGroupPaths,
} from '../../domain/hostGroupPathMutations';
import {
  STORAGE_KEY_GROUP_CONFIGS,
  STORAGE_KEY_GROUPS,
  STORAGE_KEY_HOSTS,
  STORAGE_KEY_MANAGED_SOURCES,
  STORAGE_KEY_SNIPPETS,
} from '../../infrastructure/config/storageKeys';
import { commitVaultGroupMutationPersistence } from './vaultGroupMutationPersistence';

const createStorage = (initial: Record<string, unknown>, failKey?: string) => {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
  return {
    values,
    read<T>(key: string): T | null {
      const value = values.get(key);
      return value === undefined ? null : JSON.parse(value) as T;
    },
    readString: (key: string) => values.get(key) ?? null,
    write<T>(key: string, value: T) {
      if (key === failKey) return false;
      values.set(key, JSON.stringify(value));
      return true;
    },
    writeString(key: string, value: string) {
      values.set(key, value);
      return true;
    },
    remove(key: string) {
      values.delete(key);
    },
  };
};

const identity = async <T>(value: T): Promise<T> => value;
const prepareState = <T>(value: T): T => value;

const initialHost: Host = {
  id: 'host-1', label: 'Host', hostname: 'host.test', username: 'root',
  group: 'prod', tags: [], os: 'linux',
};
const initialSnippet: Snippet = {
  id: 'script-1', label: 'Deploy', command: 'nct.log(1)', kind: 'script',
  targetGroups: ['prod'],
};

function initialVault() {
  return {
    [STORAGE_KEY_HOSTS]: [initialHost],
    [STORAGE_KEY_GROUPS]: ['prod'],
    [STORAGE_KEY_MANAGED_SOURCES]: [],
    [STORAGE_KEY_GROUP_CONFIGS]: [{ path: 'prod', username: 'root' }],
    [STORAGE_KEY_SNIPPETS]: [initialSnippet],
  };
}

test('group rename rolls back every Vault key when the snippet write fails', async () => {
  const initial = initialVault();
  const storage = createStorage(initial, STORAGE_KEY_SNIPPETS);

  await assert.rejects(commitVaultGroupMutationPersistence({
    storage,
    mutate: (current) => ({
      ok: true,
      state: {
        ...current,
        groups: ['production'],
        configs: current.configs.map((config) => ({ ...config, path: 'production' })),
        hosts: current.hosts.map((host) => ({ ...host, group: 'production' })),
        snippets: remapSnippetTargetGroupPaths(current.snippets, 'prod', 'production'),
      },
    }),
    prepareState,
    decryptHosts: identity,
    decryptConfigs: identity,
    encryptHosts: identity,
    encryptConfigs: identity,
    isCurrent: () => true,
  }), /rejected importer transaction/);

  for (const [key, value] of Object.entries(initial)) {
    assert.deepEqual(storage.read(key), value);
  }
});

test('group delete rolls back every Vault key when the snippet write fails', async () => {
  const initial = initialVault();
  const storage = createStorage(initial, STORAGE_KEY_SNIPPETS);

  await assert.rejects(commitVaultGroupMutationPersistence({
    storage,
    mutate: (current) => ({
      ok: true,
      state: {
        ...current,
        groups: [],
        configs: [],
        hosts: current.hosts.map((host) => ({ ...host, group: undefined })),
        snippets: removeSnippetTargetGroupPaths(current.snippets, ['prod']),
      },
    }),
    prepareState,
    decryptHosts: identity,
    decryptConfigs: identity,
    encryptHosts: identity,
    encryptConfigs: identity,
    isCurrent: () => true,
  }), /rejected importer transaction/);

  for (const [key, value] of Object.entries(initial)) {
    assert.deepEqual(storage.read(key), value);
  }
});

test('group rename preserves a concurrent snippet update from the locked snapshot', async () => {
  const concurrentSnippet = { ...initialSnippet, command: 'nct.log(2)' };
  const addedSnippet: Snippet = {
    id: 'script-2', label: 'Check', command: 'nct.log(3)', kind: 'script',
    targetGroups: ['prod/child'],
  };
  const storage = createStorage({
    ...initialVault(),
    [STORAGE_KEY_SNIPPETS]: [concurrentSnippet, addedSnippet],
  });

  const result = await commitVaultGroupMutationPersistence({
    storage,
    mutate: (current) => ({
      ok: true,
      state: {
        ...current,
        groups: ['production'],
        snippets: remapSnippetTargetGroupPaths(current.snippets, 'prod', 'production'),
      },
    }),
    prepareState,
    decryptHosts: identity,
    decryptConfigs: identity,
    encryptHosts: identity,
    encryptConfigs: identity,
    isCurrent: () => true,
  });

  assert.equal(result.ok, true);
  const saved = storage.read<Snippet[]>(STORAGE_KEY_SNIPPETS) ?? [];
  assert.equal(saved[0]?.command, 'nct.log(2)');
  assert.deepEqual(saved.map((snippet) => snippet.targetGroups), [
    ['production'],
    ['production/child'],
  ]);
});

test('group delete cleans targets from the latest persisted snippet snapshot', async () => {
  const concurrentSnippet = { ...initialSnippet, command: 'nct.log(2)' };
  const addedSnippet: Snippet = {
    id: 'script-2', label: 'Check', command: 'nct.log(3)', kind: 'script',
    targetGroups: ['prod/child', 'staging'],
  };
  const storage = createStorage({
    ...initialVault(),
    [STORAGE_KEY_SNIPPETS]: [concurrentSnippet, addedSnippet],
  });

  const result = await commitVaultGroupMutationPersistence({
    storage,
    mutate: (current) => ({
      ok: true,
      state: {
        ...current,
        groups: [],
        snippets: removeSnippetTargetGroupPaths(current.snippets, ['prod']),
      },
    }),
    prepareState,
    decryptHosts: identity,
    decryptConfigs: identity,
    encryptHosts: identity,
    encryptConfigs: identity,
    isCurrent: () => true,
  });

  assert.equal(result.ok, true);
  const saved = storage.read<Snippet[]>(STORAGE_KEY_SNIPPETS) ?? [];
  assert.equal(saved[0]?.command, 'nct.log(2)');
  assert.deepEqual(saved.map((snippet) => snippet.targetGroups), [
    [],
    ['staging'],
  ]);
});

test('group mutation stops before writing when memory is ahead of persisted Vault state', async () => {
  const storage = createStorage(initialVault());
  let mutateCalled = false;

  const result = await commitVaultGroupMutationPersistence({
    storage,
    mutate: (current) => {
      mutateCalled = true;
      return { ok: true, state: current };
    },
    prepareState,
    decryptHosts: identity,
    decryptConfigs: identity,
    encryptHosts: identity,
    encryptConfigs: identity,
    isCurrent: () => true,
    validateCurrent: (current) => current.snippets[0]?.command === 'nct.log(2)',
  });

  assert.deepEqual(result, { ok: false, superseded: true });
  assert.equal(mutateCalled, false);
  assert.deepEqual(storage.read<Snippet[]>(STORAGE_KEY_SNIPPETS), [initialSnippet]);
});
