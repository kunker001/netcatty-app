import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appViewSource = readFileSync(new URL("./AppView.tsx", import.meta.url), "utf8");
const pluginHostSource = readFileSync(new URL("./AppPluginKeybindingHost.tsx", import.meta.url), "utf8");
const editorSurfaceSource = readFileSync(new URL("./AppHostEditorSurface.tsx", import.meta.url), "utf8");

test("AppView shell does not subscribe to useActiveTabId", () => {
  // Top-tab switches must not rebuild the AppView shell. Leaves own the subscription.
  assert.doesNotMatch(appViewSource, /useActiveTabId\s*\(/);
  assert.doesNotMatch(appViewSource, /useActiveTabId/);
  // Still uses activeTabStore for imperative tab close / neighbor activation.
  assert.match(appViewSource, /activeTabStore/);
});

test("plugin keybindings and host-editor surface subscribe as leaves", () => {
  assert.match(pluginHostSource, /useActiveTabId/);
  assert.match(pluginHostSource, /resolveActivePluginKeybindingContext/);
  assert.match(editorSurfaceSource, /useWorkSurfaceVisible/);
  assert.match(editorSurfaceSource, /useActiveTabId/);
  assert.match(appViewSource, /AppPluginKeybindingHost/);
});
