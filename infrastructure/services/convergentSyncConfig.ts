import { STORAGE_KEY_CONVERGENT_SYNC_CONFIG } from '../config/storageKeys';
import {
  LOCAL_STORAGE_ADAPTER_CHANGED_EVENT,
  localStorageAdapter,
} from '../persistence/localStorageAdapter';

export interface ConvergentSyncLocalConfig {
  enabled: boolean;
  initialized: boolean;
}

const DEFAULT_CONFIG: ConvergentSyncLocalConfig = {
  enabled: false,
  initialized: false,
};

const listeners = new Set<() => void>();
let cachedConfig: ConvergentSyncLocalConfig = DEFAULT_CONFIG;
let hasCachedConfig = false;
let detachStorageListeners: (() => void) | null = null;

function readConvergentSyncLocalConfig(): ConvergentSyncLocalConfig {
  if (typeof globalThis.localStorage === 'undefined') return DEFAULT_CONFIG;
  const stored = localStorageAdapter.read<Partial<ConvergentSyncLocalConfig>>(
    STORAGE_KEY_CONVERGENT_SYNC_CONFIG,
  );
  return {
    enabled: stored?.enabled === true,
    initialized: stored?.initialized === true,
  };
}

function configsEqual(
  left: ConvergentSyncLocalConfig,
  right: ConvergentSyncLocalConfig,
): boolean {
  return left.enabled === right.enabled && left.initialized === right.initialized;
}

function updateCachedConfig(
  next: ConvergentSyncLocalConfig,
  notify: boolean,
): ConvergentSyncLocalConfig {
  if (hasCachedConfig && configsEqual(cachedConfig, next)) return cachedConfig;
  cachedConfig = next;
  hasCachedConfig = true;
  if (notify) {
    listeners.forEach((listener) => listener());
  }
  return cachedConfig;
}

export function getConvergentSyncLocalConfig(): ConvergentSyncLocalConfig {
  return updateCachedConfig(readConvergentSyncLocalConfig(), true);
}

export function getConvergentSyncLocalConfigSnapshot(): ConvergentSyncLocalConfig {
  if (!hasCachedConfig) {
    updateCachedConfig(readConvergentSyncLocalConfig(), false);
  }
  return cachedConfig;
}

export function refreshConvergentSyncLocalConfigSnapshot(): ConvergentSyncLocalConfig {
  return updateCachedConfig(readConvergentSyncLocalConfig(), true);
}

function installStorageListeners(): () => void {
  const target = globalThis as typeof globalThis & {
    addEventListener?: (type: string, listener: EventListener) => void;
    removeEventListener?: (type: string, listener: EventListener) => void;
  };
  if (
    typeof target.addEventListener !== 'function'
    || typeof target.removeEventListener !== 'function'
  ) {
    return () => {};
  }

  const handleStorageChange: EventListener = (event) => {
    const key = event.type === 'storage'
      ? (event as StorageEvent).key
      : (event as CustomEvent<{ key?: string }>).detail?.key;
    if (key !== null && key !== STORAGE_KEY_CONVERGENT_SYNC_CONFIG) return;
    refreshConvergentSyncLocalConfigSnapshot();
  };

  target.addEventListener('storage', handleStorageChange);
  target.addEventListener(LOCAL_STORAGE_ADAPTER_CHANGED_EVENT, handleStorageChange);
  return () => {
    target.removeEventListener?.('storage', handleStorageChange);
    target.removeEventListener?.(LOCAL_STORAGE_ADAPTER_CHANGED_EVENT, handleStorageChange);
  };
}

export function subscribeConvergentSyncLocalConfig(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    detachStorageListeners = installStorageListeners();
  }
  // Close the read-before-subscribe race required by useSyncExternalStore:
  // storage may have changed after render read the snapshot but before the
  // subscription was installed.
  refreshConvergentSyncLocalConfigSnapshot();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      detachStorageListeners?.();
      detachStorageListeners = null;
    }
  };
}

export function setConvergentSyncLocalConfig(
  config: ConvergentSyncLocalConfig,
): ConvergentSyncLocalConfig {
  const normalized = {
    enabled: config.enabled === true,
    initialized: config.initialized === true,
  };
  if (!localStorageAdapter.write(STORAGE_KEY_CONVERGENT_SYNC_CONFIG, normalized)) {
    throw new Error('Unable to persist convergent sync configuration');
  }
  return updateCachedConfig(normalized, true);
}

/** Disabling after initialization pauses v2; it never removes replica metadata. */
export function pauseConvergentSync(): ConvergentSyncLocalConfig {
  const current = getConvergentSyncLocalConfig();
  return setConvergentSyncLocalConfig({
    enabled: false,
    initialized: current.initialized,
  });
}

export function markConvergentSyncInitialized(): ConvergentSyncLocalConfig {
  return setConvergentSyncLocalConfig({ enabled: true, initialized: true });
}

export function clearConvergentSyncLocalConfigAfterDowngrade(
  confirmed: boolean,
): ConvergentSyncLocalConfig {
  if (!confirmed) throw new Error('Explicit confirmation is required to downgrade convergent sync');
  return setConvergentSyncLocalConfig(DEFAULT_CONFIG);
}
