import { isActiveChromeThemeResolvable, resolveActiveChromeTheme } from '../app/activeChromeTheme';
import { clearTopTabsChromeThemeVars } from '../app/topTabsChromeTheme';
import type { TerminalAppearanceHostScope, ResolvedAppearance } from '../../domain/terminalAppearanceRuntime';
import type { Host, TerminalSession, TerminalTheme, Workspace } from '../../types';
import { activeTabStore } from './activeTabStore';
import type { EditorTabChrome } from './editorTabStore';
import type { LogView } from './logViewState';
import { syncActiveChromeTheme, themeFingerprint } from './useActiveChromeTheme';

export type ActiveChromeThemeDeps = {
  accentMode: 'theme' | 'custom';
  applyAppTheme: () => void;
  currentTerminalTheme: TerminalTheme;
  customAccent: string;
  editorTabs: readonly EditorTabChrome[];
  followAppTerminalTheme: boolean;
  hostById: Map<string, Host>;
  logViews: readonly LogView[];
  resolveSessionAppearance?: (hostScope: TerminalAppearanceHostScope) => ResolvedAppearance;
  sessionById: Map<string, TerminalSession>;
  themeById: Map<string, TerminalTheme>;
  workspaceById: Map<string, Workspace>;
};

let depsRef: ActiveChromeThemeDeps | null = null;
let pendingRafId: number | null = null;
let pendingActiveTabId: string | null = null;

export function updateActiveChromeThemeDeps(deps: ActiveChromeThemeDeps): void {
  depsRef = deps;
}

/**
 * Apply chrome theme for a tab. Short-circuits when the resolved theme
 * fingerprint matches the already-applied chrome fingerprint so rapid tab
 * clicks do not force style work. Tab switches always use instant mode via
 * syncActiveChromeTheme (no view transitions).
 */
export function applyChromeThemeForTab(activeTabId: string): void {
  if (!depsRef || typeof document === 'undefined') return;
  if (activeTabId === 'vault' || activeTabId === 'sftp') {
    clearTopTabsChromeThemeVars();
  }
  // Non-terminal tabs: React chrome effect clears overlay theme. Do not force
  // a full style reset here on every vault/sftp click.
  if (!isActiveChromeThemeResolvable({ ...depsRef, activeTabId })) return;
  const activeTheme = resolveActiveChromeTheme({ ...depsRef, activeTabId });
  // Fingerprint short-circuit is also inside syncActiveChromeTheme; check here
  // so we avoid even building transition work when the theme is unchanged.
  if (activeTheme) {
    const nextFp = themeFingerprint(activeTheme);
    const applied = document.documentElement.dataset.activeChromeTheme ?? null;
    if (nextFp === applied) return;
  }
  syncActiveChromeTheme(activeTheme, depsRef.applyAppTheme);
}

/**
 * Schedule chrome theme apply on the next animation frame so click handlers
 * and React commit are not blocked by :root CSS rewrites.
 */
export function notifyActiveChromeThemeForTab(activeTabId: string): void {
  pendingActiveTabId = activeTabId;
  if (typeof document === 'undefined') {
    applyChromeThemeForTab(activeTabId);
    return;
  }
  if (pendingRafId !== null) return;
  const schedule = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0) as unknown as number;
  pendingRafId = schedule(() => {
    pendingRafId = null;
    const tabId = pendingActiveTabId;
    pendingActiveTabId = null;
    if (tabId != null) applyChromeThemeForTab(tabId);
  });
}

activeTabStore.subscribeSync(notifyActiveChromeThemeForTab);
