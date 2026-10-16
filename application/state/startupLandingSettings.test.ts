import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("startup landing setting participates in cross-window settings sync", () => {
  const storageSyncSource = readFileSync(new URL("./settingsStorageSync.ts", import.meta.url), "utf8");
  const ipcSyncSource = readFileSync(new URL("./settingsIpcSync.ts", import.meta.url), "utf8");

  assert.match(storageSyncSource, /STORAGE_KEY_STARTUP_LANDING/);
  assert.match(storageSyncSource, /setStartupLandingState/);
  assert.match(storageSyncSource, /e\.key === STORAGE_KEY_STARTUP_LANDING/);

  assert.match(ipcSyncSource, /STORAGE_KEY_STARTUP_LANDING/);
  assert.match(ipcSyncSource, /setStartupLandingState/);
  assert.match(ipcSyncSource, /key === STORAGE_KEY_STARTUP_LANDING/);
});

test("startup landing does not bump the cloud sync settings version", () => {
  const settingsSource = readFileSync(new URL("./useSettingsState.ts", import.meta.url), "utf8");
  const settingsVersionIndex = settingsSource.indexOf("settingsVersion: useMemo");
  const settingsVersionSource = settingsSource.slice(settingsVersionIndex);

  assert.notEqual(settingsVersionIndex, -1);
  assert.doesNotMatch(settingsVersionSource, /startupLanding/);
});

test("main window opens local terminal on cold start when preferred", () => {
  const sideEffectsSource = readFileSync(new URL("../app/AppSideEffects.tsx", import.meta.url), "utf8");

  assert.match(sideEffectsSource, /startupLocalTerminalAttemptedRef/);
  assert.match(sideEffectsSource, /shouldOpenLocalTerminalOnStartup/);
  assert.match(sideEffectsSource, /STORAGE_KEY_STARTUP_LANDING/);
  assert.match(sideEffectsSource, /handleCreateLocalTerminal\(/);
  assert.match(sideEffectsSource, /onColdStartIntentsSettled/);
  assert.match(sideEffectsSource, /ensureDiscoveredShells/);
  assert.match(sideEffectsSource, /hasQueuedStartupIntent:\s*startupLaunchIntentReceivedRef\.current/);

  const latchAt = sideEffectsSource.indexOf("if (startupLocalTerminalAttemptedRef.current) return;");
  const setLatchAt = sideEffectsSource.indexOf(
    "startupLocalTerminalAttemptedRef.current = true;",
    latchAt,
  );
  const createAt = sideEffectsSource.indexOf("handleCreateLocalTerminal(", setLatchAt);
  assert.notEqual(latchAt, -1);
  assert.notEqual(setLatchAt, -1);
  assert.notEqual(createAt, -1);
  assert.ok(setLatchAt < createAt, "StrictMode latch must be set before creating the terminal");
});

test("settings system tab exposes startup landing control", () => {
  const tabSource = readFileSync(
    new URL("../../components/settings/tabs/SettingsSystemTab.tsx", import.meta.url),
    "utf8",
  );
  assert.match(tabSource, /system-startup-landing/);
  assert.match(tabSource, /settings\.sessionRestore\.startupLanding/);
  assert.match(tabSource, /local-terminal/);
});
