import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./activeChromeThemeSync.ts", import.meta.url), "utf8");
const chromeThemeSource = readFileSync(new URL("./useActiveChromeTheme.ts", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("./activeTabStore.ts", import.meta.url), "utf8");

test("active tab changes notify chrome theme before react subscribers", () => {
  const setActiveTabIdBody = storeSource.match(/setActiveTabId = \(id: string(?:, options\?: \w+)?\) => \{[\s\S]*?\n {2}\};/)?.[0] ?? "";
  assert.match(setActiveTabIdBody, /this\.syncListeners\.forEach\(\(listener\) => listener\(id\)\)/);
  assert.match(setActiveTabIdBody, /this\.scheduleNotify\(\)/);
  assert.ok(
    setActiveTabIdBody.indexOf("syncListeners.forEach") < setActiveTabIdBody.indexOf("scheduleNotify"),
    "sync chrome theme listeners must run before deferred react notify",
  );
  assert.match(source, /activeTabStore\.subscribeSync\(notifyActiveChromeThemeForTab\)/);
  assert.match(source, /isActiveChromeThemeResolvable/);
  assert.match(source, /clearTopTabsChromeThemeVars/);
});

test("tab chrome notify defers apply via rAF and short-circuits on fingerprint", () => {
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /themeFingerprint/);
  assert.match(source, /export function applyChromeThemeForTab/);
  assert.match(source, /export function notifyActiveChromeThemeForTab/);
  // Tab path must not use view transitions.
  assert.doesNotMatch(source, /mode:\s*['"]view['"]/);
});

test("syncActiveChromeTheme applies terminal chrome with instant mode", () => {
  assert.match(chromeThemeSource, /mode:\s*['"]instant['"]/);
  assert.match(chromeThemeSource, /nextFingerprint === appliedFingerprint/);
});
