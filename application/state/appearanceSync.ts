import {
  STORAGE_KEY_ACCENT_MODE,
  STORAGE_KEY_COLOR,
  STORAGE_KEY_THEME,
  STORAGE_KEY_UI_THEME_DARK,
  STORAGE_KEY_UI_THEME_LIGHT,
} from '../../infrastructure/config/storageKeys';
import {
  isValidTheme,
  isValidUiThemeId,
} from './settingsStateDefaults';
import {
  parseCustomAccentRecord,
  shouldApplyCustomAccentRecord,
  type CustomAccentRecord,
} from './customAccentSync';

export type AppearanceState = {
  theme: "light" | "dark" | "system";
  lightUiThemeId: string;
  darkUiThemeId: string;
  accentMode: "theme" | "custom";
  customAccent: string;
  /** Sync revision for custom accent; gates stale IPC/storage echoes during color-picker drag. */
  customAccentVersion: number;
};

export type AppearanceRenderSnapshot = {
  theme: AppearanceState["theme"];
  resolvedTheme: "light" | "dark";
} & Omit<AppearanceState, "theme">;

export type AppearanceSyncEvent = {
  key: string;
  value: unknown;
};

export type StoredAppearanceValues = {
  theme: unknown;
  lightUiThemeId: unknown;
  darkUiThemeId: unknown;
  accentMode: unknown;
  customAccent: unknown;
};

export type AppearanceStorageEventResolution = {
  handled: boolean;
  next: AppearanceState;
};

export function hasPersistedAppearanceChanged(
  previous: AppearanceRenderSnapshot,
  current: AppearanceRenderSnapshot,
): boolean {
  return previous.theme !== current.theme
    || previous.lightUiThemeId !== current.lightUiThemeId
    || previous.darkUiThemeId !== current.darkUiThemeId
    || previous.accentMode !== current.accentMode
    || previous.customAccent !== current.customAccent
    || previous.customAccentVersion !== current.customAccentVersion;
}

export function resolveIncomingAppearanceValue<T>(
  incoming: AppearanceSyncEvent | undefined,
  key: string,
  storedValue: T,
  currentValue: T,
  isValid: (value: unknown) => value is T,
): T {
  if (incoming?.key === key && isValid(incoming.value)) {
    return incoming.value;
  }
  // Keyed IPC updates only trust the announced key. Non-matching fields keep
  // the in-memory current value so sequential notifies for one multi-field
  // change cannot clobber each other with a still-stale storage read.
  // Full rehydrate (no incoming) continues to prefer shared storage.
  if (incoming) {
    return currentValue;
  }
  return storedValue;
}

export function resolveAppearanceSyncState(
  current: AppearanceState,
  stored: StoredAppearanceValues,
  incoming?: AppearanceSyncEvent,
): AppearanceState {
  const theme = resolveIncomingAppearanceValue(
    incoming,
    STORAGE_KEY_THEME,
    stored.theme,
    current.theme,
    isValidTheme,
  );
  const lightUiThemeId = resolveIncomingAppearanceValue(
    incoming,
    STORAGE_KEY_UI_THEME_LIGHT,
    stored.lightUiThemeId,
    current.lightUiThemeId,
    (value): value is string => typeof value === 'string' && isValidUiThemeId('light', value),
  );
  const darkUiThemeId = resolveIncomingAppearanceValue(
    incoming,
    STORAGE_KEY_UI_THEME_DARK,
    stored.darkUiThemeId,
    current.darkUiThemeId,
    (value): value is string => typeof value === 'string' && isValidUiThemeId('dark', value),
  );
  const accentMode = resolveIncomingAppearanceValue(
    incoming,
    STORAGE_KEY_ACCENT_MODE,
    stored.accentMode,
    current.accentMode,
    (value): value is AppearanceState['accentMode'] => value === 'theme' || value === 'custom',
  );
  const currentAccentRecord: CustomAccentRecord = {
    color: current.customAccent,
    version: current.customAccentVersion,
  };
  const incomingAccentRaw = incoming?.key === STORAGE_KEY_COLOR ? incoming.value : undefined;
  const resolvedAccentRaw = incomingAccentRaw !== undefined
    ? incomingAccentRaw
    : (incoming ? currentAccentRecord : stored.customAccent);
  const resolvedAccentRecord = incomingAccentRaw !== undefined || !incoming
    ? parseCustomAccentRecord(resolvedAccentRaw)
    : currentAccentRecord;
  const nextAccentRecord = shouldApplyCustomAccentRecord(currentAccentRecord, resolvedAccentRecord)
    ? resolvedAccentRecord
    : currentAccentRecord;

  return {
    theme: isValidTheme(theme) ? theme : current.theme,
    lightUiThemeId: typeof lightUiThemeId === 'string' && isValidUiThemeId('light', lightUiThemeId)
      ? lightUiThemeId
      : current.lightUiThemeId,
    darkUiThemeId: typeof darkUiThemeId === 'string' && isValidUiThemeId('dark', darkUiThemeId)
      ? darkUiThemeId
      : current.darkUiThemeId,
    accentMode: accentMode === 'theme' || accentMode === 'custom' ? accentMode : current.accentMode,
    customAccent: nextAccentRecord.color,
    customAccentVersion: nextAccentRecord.version,
  };
}

export function resolveAppearanceStorageEvent(
  current: AppearanceState,
  key: string | null,
  newValue: string | null,
): AppearanceStorageEventResolution {
  if (key === STORAGE_KEY_THEME) {
    return {
      handled: true,
      next: newValue && isValidTheme(newValue) ? { ...current, theme: newValue } : current,
    };
  }
  if (key === STORAGE_KEY_UI_THEME_LIGHT) {
    return {
      handled: true,
      next: newValue && isValidUiThemeId('light', newValue)
        ? { ...current, lightUiThemeId: newValue }
        : current,
    };
  }
  if (key === STORAGE_KEY_UI_THEME_DARK) {
    return {
      handled: true,
      next: newValue && isValidUiThemeId('dark', newValue)
        ? { ...current, darkUiThemeId: newValue }
        : current,
    };
  }
  if (key === STORAGE_KEY_ACCENT_MODE) {
    return {
      handled: true,
      next: newValue === 'theme' || newValue === 'custom'
        ? { ...current, accentMode: newValue }
        : current,
    };
  }
  if (key === STORAGE_KEY_COLOR) {
    if (newValue == null) {
      return { handled: true, next: current };
    }
    const incoming = parseCustomAccentRecord(newValue);
    const currentRecord: CustomAccentRecord = {
      color: current.customAccent,
      version: current.customAccentVersion,
    };
    if (!shouldApplyCustomAccentRecord(currentRecord, incoming)) {
      return { handled: true, next: current };
    }
    return {
      handled: true,
      next: {
        ...current,
        customAccent: incoming.color,
        customAccentVersion: incoming.version,
      },
    };
  }
  return { handled: false, next: current };
}
