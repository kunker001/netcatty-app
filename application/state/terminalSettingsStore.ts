import { useSyncExternalStore } from 'react';

import type {
  HotkeyScheme,
  KeyBinding,
  SessionLogFormat,
  TerminalSettings,
} from '../../domain/models';
import { normalizeTerminalSettings } from '../../domain/models';
import type { useSettingsState } from './useSettingsState';

type SettingsState = ReturnType<typeof useSettingsState>;

type Listener = () => void;

/**
 * Terminal-facing settings slice. Mirrors `settingsChromeStore`: values and
 * actions live on separate slots so setter identity churn never invalidates
 * the value snapshot TerminalHost / terminal domain bags subscribe to.
 */
export type TerminalSettingsSnapshot = {
  terminalThemeId: string;
  terminalThemeDarkId: string;
  terminalThemeLightId: string;
  followAppTerminalTheme: boolean;
  terminalFontFamilyId: string;
  terminalFontSize: number;
  terminalSettings: TerminalSettings;
  hotkeyScheme: HotkeyScheme;
  keyBindings: readonly KeyBinding[];
  isHotkeyRecording: boolean;
  sftpDoubleClickBehavior: 'open' | 'transfer';
  sftpAutoSync: boolean;
  sftpShowHiddenFiles: boolean;
  sftpUseCompressedUpload: boolean;
  sftpAutoOpenSidebar: boolean;
  sftpFollowTerminalCwd: boolean;
  sftpDefaultViewMode: 'list' | 'tree';
  editorWordWrap: boolean;
  sessionLogsEnabled: boolean;
  sessionLogsDir: string;
  sessionLogsFormat: SessionLogFormat;
  sessionLogsTimestampsEnabled: boolean;
  sshDebugLogsEnabled: boolean;
};

export type TerminalSettingsActions = Pick<
  SettingsState,
  | 'setTerminalThemeId'
  | 'setTerminalThemeDarkId'
  | 'setTerminalThemeLightId'
  | 'setFollowAppTerminalTheme'
  | 'setTerminalFontFamilyId'
  | 'setTerminalFontSize'
  | 'updateTerminalSetting'
  | 'setSftpFollowTerminalCwd'
  | 'setEditorWordWrap'
  | 'applyAppTheme'
>;

export const DEFAULT_TERMINAL_SETTINGS_SNAPSHOT: TerminalSettingsSnapshot = Object.freeze({
  terminalThemeId: 'default',
  terminalThemeDarkId: 'default',
  terminalThemeLightId: 'default',
  followAppTerminalTheme: true,
  terminalFontFamilyId: 'default',
  terminalFontSize: 14,
  terminalSettings: normalizeTerminalSettings(),
  hotkeyScheme: 'mac',
  keyBindings: Object.freeze([]) as readonly KeyBinding[],
  isHotkeyRecording: false,
  sftpDoubleClickBehavior: 'open',
  sftpAutoSync: false,
  sftpShowHiddenFiles: false,
  sftpUseCompressedUpload: false,
  sftpAutoOpenSidebar: false,
  sftpFollowTerminalCwd: false,
  sftpDefaultViewMode: 'list',
  editorWordWrap: true,
  sessionLogsEnabled: false,
  sessionLogsDir: '',
  sessionLogsFormat: 'txt',
  sessionLogsTimestampsEnabled: false,
  sshDebugLogsEnabled: false,
});

export function terminalSettingsSnapshotsEqual(
  a: TerminalSettingsSnapshot,
  b: TerminalSettingsSnapshot,
): boolean {
  return a.terminalThemeId === b.terminalThemeId
    && a.terminalThemeDarkId === b.terminalThemeDarkId
    && a.terminalThemeLightId === b.terminalThemeLightId
    && a.followAppTerminalTheme === b.followAppTerminalTheme
    && a.terminalFontFamilyId === b.terminalFontFamilyId
    && a.terminalFontSize === b.terminalFontSize
    && a.terminalSettings === b.terminalSettings
    && a.hotkeyScheme === b.hotkeyScheme
    && a.keyBindings === b.keyBindings
    && a.isHotkeyRecording === b.isHotkeyRecording
    && a.sftpDoubleClickBehavior === b.sftpDoubleClickBehavior
    && a.sftpAutoSync === b.sftpAutoSync
    && a.sftpShowHiddenFiles === b.sftpShowHiddenFiles
    && a.sftpUseCompressedUpload === b.sftpUseCompressedUpload
    && a.sftpAutoOpenSidebar === b.sftpAutoOpenSidebar
    && a.sftpFollowTerminalCwd === b.sftpFollowTerminalCwd
    && a.sftpDefaultViewMode === b.sftpDefaultViewMode
    && a.editorWordWrap === b.editorWordWrap
    && a.sessionLogsEnabled === b.sessionLogsEnabled
    && a.sessionLogsDir === b.sessionLogsDir
    && a.sessionLogsFormat === b.sessionLogsFormat
    && a.sessionLogsTimestampsEnabled === b.sessionLogsTimestampsEnabled
    && a.sshDebugLogsEnabled === b.sshDebugLogsEnabled;
}

class TerminalSettingsStore {
  private snapshot: TerminalSettingsSnapshot = DEFAULT_TERMINAL_SETTINGS_SNAPSHOT;
  private actions: TerminalSettingsActions | null = null;
  private listeners = new Set<Listener>();
  private actionListeners = new Set<Listener>();

  getSnapshot = (): TerminalSettingsSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  setSnapshot(next: TerminalSettingsSnapshot): void {
    if (terminalSettingsSnapshotsEqual(this.snapshot, next)) return;
    this.snapshot = next;
    for (const listener of this.listeners) {
      listener();
    }
  }

  getActions = (): TerminalSettingsActions | null => this.actions;

  subscribeActions = (listener: Listener): (() => void) => {
    this.actionListeners.add(listener);
    return () => {
      this.actionListeners.delete(listener);
    };
  };

  setActions(next: TerminalSettingsActions | null): void {
    if (this.actions === next) return;
    this.actions = next;
    for (const listener of this.actionListeners) {
      listener();
    }
  }
}

export const terminalSettingsStore = new TerminalSettingsStore();

export function publishTerminalSettingsSnapshot(
  snapshot: TerminalSettingsSnapshot,
): void {
  terminalSettingsStore.setSnapshot(snapshot);
}

export function getTerminalSettingsSnapshot(): TerminalSettingsSnapshot {
  return terminalSettingsStore.getSnapshot();
}

export function subscribeTerminalSettings(listener: Listener): () => void {
  return terminalSettingsStore.subscribe(listener);
}

export function registerTerminalSettingsActions(
  actions: TerminalSettingsActions | null,
): void {
  terminalSettingsStore.setActions(actions);
}

export function getTerminalSettingsActions(): TerminalSettingsActions | null {
  return terminalSettingsStore.getActions();
}

export function subscribeTerminalSettingsActions(listener: Listener): () => void {
  return terminalSettingsStore.subscribeActions(listener);
}

export function useTerminalSettingsStore(): TerminalSettingsSnapshot {
  return useSyncExternalStore(
    subscribeTerminalSettings,
    getTerminalSettingsSnapshot,
    getTerminalSettingsSnapshot,
  );
}

export function useTerminalSettingsActions(): TerminalSettingsActions | null {
  return useSyncExternalStore(
    subscribeTerminalSettingsActions,
    getTerminalSettingsActions,
    getTerminalSettingsActions,
  );
}
