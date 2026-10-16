import type { GroupConfig, Host, ManagedSource, Snippet } from '../../domain/models';
import type {
  VaultGroupMutationResult,
  VaultGroupMutationState,
} from '../../domain/vaultGroupMutation';
import {
  STORAGE_KEY_GROUP_CONFIGS,
  STORAGE_KEY_GROUPS,
  STORAGE_KEY_HOSTS,
  STORAGE_KEY_MANAGED_SOURCES,
  STORAGE_KEY_SNIPPETS,
} from '../../infrastructure/config/storageKeys';
import { commitPluginImporterTransaction } from './pluginImporterTransaction';
import { readStoredArray } from './vaultImportPersistence';

type TransactionStorage = {
  read<T>(key: string): T | null;
  readString(key: string): string | null;
  write<T>(key: string, value: T): boolean;
  writeString(key: string, value: string): boolean;
  remove(key: string): void;
};

const GROUP_MUTATION_KEYS = [
  STORAGE_KEY_HOSTS,
  STORAGE_KEY_GROUPS,
  STORAGE_KEY_MANAGED_SOURCES,
  STORAGE_KEY_GROUP_CONFIGS,
  STORAGE_KEY_SNIPPETS,
] as const;

export async function commitVaultGroupMutationPersistence({
  storage,
  mutate,
  prepareState,
  decryptHosts,
  decryptConfigs,
  encryptHosts,
  encryptConfigs,
  isCurrent,
  validateCurrent,
}: {
  storage: TransactionStorage;
  mutate: (current: VaultGroupMutationState) => VaultGroupMutationResult;
  prepareState: (state: VaultGroupMutationState) => VaultGroupMutationState;
  decryptHosts: (hosts: Host[]) => Promise<Host[]>;
  decryptConfigs: (configs: GroupConfig[]) => Promise<GroupConfig[]>;
  encryptHosts: (hosts: Host[]) => Promise<unknown>;
  encryptConfigs: (configs: GroupConfig[]) => Promise<unknown>;
  isCurrent: () => boolean;
  validateCurrent?: (current: VaultGroupMutationState) => boolean;
}): Promise<VaultGroupMutationResult | { ok: false; superseded: true }> {
  const raw = new Map(GROUP_MUTATION_KEYS.map((key) => [key, storage.readString(key)]));
  const [hosts, configs] = await Promise.all([
    decryptHosts(readStoredArray<Host>(STORAGE_KEY_HOSTS, raw.get(STORAGE_KEY_HOSTS) ?? null)),
    decryptConfigs(readStoredArray<GroupConfig>(
      STORAGE_KEY_GROUP_CONFIGS,
      raw.get(STORAGE_KEY_GROUP_CONFIGS) ?? null,
    )),
  ]);
  const current: VaultGroupMutationState = {
    groups: readStoredArray<string>(STORAGE_KEY_GROUPS, raw.get(STORAGE_KEY_GROUPS) ?? null),
    configs,
    hosts,
    managedSources: readStoredArray<ManagedSource>(
      STORAGE_KEY_MANAGED_SOURCES,
      raw.get(STORAGE_KEY_MANAGED_SOURCES) ?? null,
    ),
    snippets: readStoredArray<Snippet>(STORAGE_KEY_SNIPPETS, raw.get(STORAGE_KEY_SNIPPETS) ?? null),
  };
  if (!isCurrent() || (validateCurrent && !validateCurrent(current))) {
    return { ok: false, superseded: true };
  }
  const mutation = mutate(current);
  if (!mutation.ok) return mutation;

  const nextState = prepareState(mutation.state);
  const [encryptedHosts, encryptedConfigs] = await Promise.all([
    encryptHosts(nextState.hosts),
    encryptConfigs(nextState.configs),
  ]);
  if (
    !isCurrent()
    || GROUP_MUTATION_KEYS.some((key) => storage.readString(key) !== raw.get(key))
  ) {
    return { ok: false, superseded: true };
  }

  commitPluginImporterTransaction(storage, [
    [STORAGE_KEY_HOSTS, encryptedHosts],
    [STORAGE_KEY_GROUPS, nextState.groups],
    [STORAGE_KEY_MANAGED_SOURCES, nextState.managedSources],
    [STORAGE_KEY_GROUP_CONFIGS, encryptedConfigs],
    [STORAGE_KEY_SNIPPETS, nextState.snippets],
  ]);
  return { ok: true, state: nextState };
}
