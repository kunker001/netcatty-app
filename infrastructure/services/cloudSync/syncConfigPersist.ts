import {
  DEFAULT_CLOUD_SYNC_STRATEGY,
  normalizeCloudSyncStrategy,
  type CloudSyncStrategy,
} from '../../../domain/syncStrategy';

export type SyncPreferencePersistFields = {
  autoSync: boolean;
  interval: number;
  syncStrategy: CloudSyncStrategy;
};

export type SyncPreferenceKey = keyof SyncPreferencePersistFields;

export type SyncVersionPersistFields = {
  localVersion: number;
  localUpdatedAt: number;
  remoteVersion: number;
  remoteUpdatedAt: number;
};

export type SyncConfigPersistFields = SyncPreferencePersistFields & SyncVersionPersistFields;

/**
 * Prefer the dedicated preferences key; fall back to legacy fields still
 * embedded in SYNC_CONFIG from older builds.
 */
export function coalesceStoredSyncPreferences(
  preferences: Partial<SyncPreferencePersistFields> | null | undefined,
  legacyConfig: Partial<SyncPreferencePersistFields> | null | undefined,
): Partial<SyncPreferencePersistFields> | null {
  if (preferences && typeof preferences === 'object') return preferences;
  if (legacyConfig && typeof legacyConfig === 'object') return legacyConfig;
  return null;
}

export function hasSyncPreferenceFields(
  value: Partial<SyncPreferencePersistFields> | null | undefined,
): boolean {
  if (!value || typeof value !== 'object') return false;
  return value.autoSync !== undefined
    || value.interval !== undefined
    || value.syncStrategy !== undefined;
}

export function resolveSyncPreferencesForPersist(input: {
  memory: SyncPreferencePersistFields;
  stored: Partial<SyncPreferencePersistFields> | null | undefined;
  /**
   * When true, preference fields come from this window's memory — used by
   * setAutoSync / setSyncStrategy. When false (default), preference fields
   * are taken from storage so a version-only save cannot invent prefs.
   */
  preferencesFromMemory?: boolean;
  /**
   * When preferencesFromMemory is true, only these keys are taken from
   * memory; other preference fields keep the stored value so a setter in
   * one window cannot clobber a concurrent preference edit from another.
   * Omit to take every preference field from memory (full snapshot).
   */
  memoryKeys?: readonly SyncPreferenceKey[];
}): SyncPreferencePersistFields {
  const { memory, stored, preferencesFromMemory = false, memoryKeys } = input;
  const fromStorage = stored && typeof stored === 'object' ? stored : null;

  const takeFromMemory = (key: SyncPreferenceKey): boolean => {
    if (!fromStorage) return true;
    if (!preferencesFromMemory) return false;
    if (!memoryKeys) return true;
    return memoryKeys.includes(key);
  };

  return {
    autoSync: Boolean(
      takeFromMemory('autoSync')
        ? memory.autoSync
        : fromStorage?.autoSync !== undefined
          ? fromStorage.autoSync
          : memory.autoSync,
    ),
    interval: Number(
      takeFromMemory('interval')
        ? memory.interval
        : fromStorage?.interval !== undefined
          ? fromStorage.interval
          : memory.interval,
    ),
    syncStrategy: normalizeCloudSyncStrategy(
      takeFromMemory('syncStrategy')
        ? memory.syncStrategy
        : fromStorage?.syncStrategy !== undefined
          ? fromStorage.syncStrategy
          : memory.syncStrategy ?? DEFAULT_CLOUD_SYNC_STRATEGY,
    ),
  };
}

export function resolveSyncVersionsForPersist(
  memory: SyncVersionPersistFields,
): SyncVersionPersistFields {
  return {
    localVersion: Number(memory.localVersion),
    localUpdatedAt: Number(memory.localUpdatedAt),
    remoteVersion: Number(memory.remoteVersion),
    remoteUpdatedAt: Number(memory.remoteUpdatedAt),
  };
}

/**
 * @deprecated Prefer resolveSyncPreferencesForPersist + resolveSyncVersionsForPersist.
 * Kept for unit tests that assert the combined legacy shape.
 */
export function resolveSyncConfigForPersist(input: {
  memory: SyncConfigPersistFields;
  stored: Partial<SyncConfigPersistFields> | null | undefined;
  preferencesFromMemory?: boolean;
  memoryKeys?: readonly SyncPreferenceKey[];
}): SyncConfigPersistFields {
  return {
    ...resolveSyncPreferencesForPersist({
      memory: {
        autoSync: input.memory.autoSync,
        interval: input.memory.interval,
        syncStrategy: input.memory.syncStrategy,
      },
      stored: input.stored,
      preferencesFromMemory: input.preferencesFromMemory,
      memoryKeys: input.memoryKeys,
    }),
    ...resolveSyncVersionsForPersist(input.memory),
  };
}
