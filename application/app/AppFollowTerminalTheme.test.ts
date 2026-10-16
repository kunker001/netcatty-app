import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSideEffectsSource = readFileSync(new URL("./AppSideEffects.tsx", import.meta.url), "utf8");
const terminalHostSource = readFileSync(new URL("./hosts/TerminalHost.tsx", import.meta.url), "utf8");
const appViewSource = readFileSync(new URL("./AppView.tsx", import.meta.url), "utf8");
const runtimeSource = readFileSync(new URL("../state/useThemeRuntime.ts", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../state/useSettingsState.ts", import.meta.url), "utf8");

test("follow-app terminal theme selection updates the matching UI theme via ThemeRuntime", () => {
  assert.match(runtimeSource, /getFollowAppTerminalThemeSelectionUpdate\(themeId\)/);
  assert.match(runtimeSource, /setDarkUiThemeId\(update\.uiThemeId\)/);
  assert.match(runtimeSource, /setLightUiThemeId\(update\.uiThemeId\)/);
  assert.match(runtimeSource, /setTheme\(update\.appTheme\)/);
  assert.doesNotMatch(runtimeSource, /isFollowAppIntentSettled\(userIntent\.themeId/);
  assert.match(terminalHostSource, /useThemeRuntime\(/);
  assert.match(terminalHostSource, /pickTerminalTheme\(themeId\)/);
  assert.match(terminalHostSource, /pickTheme: pickTerminalTheme/);
  // Theme members are listed field-by-field on the TerminalHost bag (not themeRuntime bag).
  assert.match(terminalHostSource, /clearThemeIntent,/);
  assert.match(terminalHostSource, /settleManualThemeIntent,/);
  assert.match(terminalHostSource, /pickTerminalTheme,/);
  assert.match(terminalHostSource, /resolveSessionAppearance: resolveFocusedAppearance/);
  assert.doesNotMatch(
    terminalHostSource,
    /followAppTerminalTheme, themeRuntime, handleConnectSerial/,
  );
  // Terminal domain must not thrash on whole settings bag identity.
  assert.match(terminalHostSource, /sshDebugLogsEnabled:/);
  assert.doesNotMatch(
    terminalHostSource,
    /splitSessionWithCurrentShell, settings, terminalFontFamilyId/,
  );
  // Hotkey path must not depend on whole settings/sessions for callback identity.
  assert.match(appSideEffectsSource, /showSftpTab: showSftpTabRef\.current/);
  assert.match(appSideEffectsSource, /sessions: sessionsRef\.current/);
  assert.match(appSideEffectsSource, /connectionLogs: connectionLogsRef\.current/);
  assert.match(terminalHostSource, /useTerminalAppearanceInjection/);
  assert.match(terminalHostSource, /includeChromeSurfaces: followAppTerminalTheme/);
  assert.match(terminalHostSource, /useTerminalAppearanceInjection\(accentedGlobalAppearance/);
  assert.match(terminalHostSource, /clearThemeIntent\(\)/);
  assert.match(runtimeSource, /injectTerminalAppearanceVars\(appearance\.theme, \{ includeChromeSurfaces \}\)/);
  assert.doesNotMatch(settingsSource, /pendingFollowAppTerminalThemeId/);
  assert.doesNotMatch(settingsSource, /applyFollowAppTerminalThemePick/);
  assert.match(settingsSource, /appearanceTransitionModeRef\.current = 'instant'/);
  assert.match(appViewSource, /data-terminal-appearance-root/);
  assert.match(appViewSource, /pickTerminalTheme=\{ctx\.pickTerminalTheme\}/);
});

test("default terminal theme selection persists via TerminalHost", () => {
  // Product path lives on TerminalHost; AppSideEffects no longer owns this handler.
  assert.match(terminalHostSource, /const handleDefaultTerminalThemeChange = useCallback\(\(themeId: string\) => \{/);
  assert.match(terminalHostSource, /setTerminalThemeId\(themeId\)/);
  assert.match(terminalHostSource, /TERMINAL_THEME_AUTO/);
  assert.match(appViewSource, /onUpdateTerminalThemeId=\{handleDefaultTerminalThemeChange\}/);
});
