import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { TerminalTheme } from '../../domain/models';
import {
  idleThemeUserIntent,
  pickingThemeUserIntent,
  resolveGlobalTerminalAppearance,
  resolveTerminalAppearance,
  type ResolvedAppearance,
  type TerminalAppearanceHostScope,
  type TerminalAppearanceSettings,
  type ThemeUserIntent,
} from '../../domain/terminalAppearanceRuntime';
import { getFollowAppTerminalThemeSelectionUpdate } from '../../domain/terminalAppearance';
import {
  injectTerminalAppearanceVars,
} from '../../infrastructure/theme/terminalAppearanceVars';

export type ThemeRuntimeSettings = TerminalAppearanceSettings & {
  customThemes: TerminalTheme[];
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  setLightUiThemeId: (id: string) => void;
  setDarkUiThemeId: (id: string) => void;
};

export function useThemeRuntime(settings: ThemeRuntimeSettings) {
  const {
    terminalThemeId,
    terminalThemeDarkId,
    terminalThemeLightId,
    followAppTerminalTheme,
    resolvedTheme,
    lightUiThemeId,
    darkUiThemeId,
    accentMode,
    customAccent,
    customThemes,
    setTheme,
    setLightUiThemeId,
    setDarkUiThemeId,
  } = settings;

  const [userIntent, setUserIntent] = useState<ThemeUserIntent>(idleThemeUserIntent());

  // Theme-id settings without accent — keeps resolveFocusedAppearance identity
  // stable during color-picker drag (TerminalLayer memo depends on it).
  const appearanceSettingsBase = useMemo((): Omit<TerminalAppearanceSettings, 'accentMode' | 'customAccent'> => ({
    terminalThemeId,
    terminalThemeDarkId,
    terminalThemeLightId,
    followAppTerminalTheme,
    resolvedTheme,
    lightUiThemeId,
    darkUiThemeId,
  }), [
    terminalThemeId,
    terminalThemeDarkId,
    terminalThemeLightId,
    followAppTerminalTheme,
    resolvedTheme,
    lightUiThemeId,
    darkUiThemeId,
  ]);

  const accentRef = useRef({ accentMode, customAccent });
  accentRef.current = { accentMode, customAccent };

  // Live accent settings are only for CSS-var injection. The published bag must
  // resolve against a stable base theme so accent drag does not rebuild
  // TerminalHost / AppShell domains every HSL tick.
  const appearanceSettingsForInject = useMemo((): TerminalAppearanceSettings => ({
    ...appearanceSettingsBase,
    accentMode,
    customAccent,
  }), [appearanceSettingsBase, accentMode, customAccent]);

  const globalAppearance = useMemo(() => resolveGlobalTerminalAppearance({
    userIntent,
    settings: {
      ...appearanceSettingsBase,
      accentMode: 'theme',
      customAccent: '',
    },
    customThemes,
  }), [userIntent, appearanceSettingsBase, customThemes]);

  const accentedGlobalAppearance = useMemo(() => resolveGlobalTerminalAppearance({
    userIntent,
    settings: appearanceSettingsForInject,
    customThemes,
  }), [userIntent, appearanceSettingsForInject, customThemes]);

  // Read accent from a ref so this callback identity does not churn on drag.
  // Callers that invoke it after an accent-only update still get the latest
  // accent; Terminal panes also re-apply appearanceChromeStore at the leaf.
  const resolveFocusedAppearance = useCallback((hostScope: TerminalAppearanceHostScope): ResolvedAppearance => (
    resolveTerminalAppearance({
      userIntent,
      settings: {
        ...appearanceSettingsBase,
        accentMode: accentRef.current.accentMode,
        customAccent: accentRef.current.customAccent,
      },
      hostScope,
      customThemes,
    })
  ), [userIntent, appearanceSettingsBase, customThemes]);

  const applyFollowAppSettingsForPick = useCallback((themeId: string) => {
    const update = getFollowAppTerminalThemeSelectionUpdate(themeId);
    if (!update) return false;
    if (update.appTheme === 'dark') {
      setDarkUiThemeId(update.uiThemeId);
    } else {
      setLightUiThemeId(update.uiThemeId);
    }
    setTheme(update.appTheme);
    return true;
  }, [setDarkUiThemeId, setLightUiThemeId, setTheme]);

  const pickTheme = useCallback((themeId: string, options?: { followApp?: boolean; scopeHostId?: string | null }) => {
    const followApp = options?.followApp ?? followAppTerminalTheme;
    setUserIntent(pickingThemeUserIntent(themeId, {
      scopeHostId: followApp ? undefined : options?.scopeHostId,
    }));
    if (followApp) {
      applyFollowAppSettingsForPick(themeId);
    }
  }, [applyFollowAppSettingsForPick, followAppTerminalTheme]);

  const clearIntent = useCallback(() => {
    setUserIntent(idleThemeUserIntent());
  }, []);

  const settleManualIntent = useCallback(() => {
    setUserIntent(idleThemeUserIntent());
  }, []);

  // Stable bag identity so App domain memos can depend on members (or the
  // bag) without thrashing on every parent render. Accented appearance is
  // intentionally excluded — injection reads it separately.
  return useMemo(() => ({
    userIntent,
    globalAppearance,
    accentedGlobalAppearance,
    resolveFocusedAppearance,
    pickTheme,
    clearIntent,
    settleManualIntent,
    currentTerminalTheme: globalAppearance.theme,
  }), [
    userIntent,
    globalAppearance,
    accentedGlobalAppearance,
    resolveFocusedAppearance,
    pickTheme,
    clearIntent,
    settleManualIntent,
  ]);
}

export function useTerminalAppearanceInjection(
  appearance: ResolvedAppearance,
  options?: { includeChromeSurfaces?: boolean },
): void {
  const includeChromeSurfaces = options?.includeChromeSurfaces ?? true;
  useLayoutEffect(() => {
    injectTerminalAppearanceVars(appearance.theme, { includeChromeSurfaces });
  }, [appearance.theme.id, appearance.theme, includeChromeSurfaces]);
}
