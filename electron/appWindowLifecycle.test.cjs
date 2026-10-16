"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createAppContentWindowClosedHandler } = require("./appWindowLifecycle.cjs");

test("last app content window closes the app even while a hidden plugin host window exists", () => {
  const hiddenPluginWindow = { isVisible: () => false };
  let quitCalls = 0;
  const handler = createAppContentWindowClosedHandler({
    app: { quit() { quitCalls += 1; } },
    platform: "linux",
    windowManager: {
      getAppContentWindows: () => [],
      getIsQuitting: () => false,
      // A hidden BrowserWindow still exists globally, but it is intentionally
      // not part of Netcatty's app-content registry.
      getAllBrowserWindows: () => [hiddenPluginWindow],
    },
  });

  assert.equal(handler(), true);
  assert.equal(quitCalls, 1);
});

test("app content close handler preserves macOS and active app windows", () => {
  let quitCalls = 0;
  const app = { quit() { quitCalls += 1; } };
  const macHandler = createAppContentWindowClosedHandler({
    app,
    platform: "darwin",
    windowManager: { getAppContentWindows: () => [], getIsQuitting: () => false },
  });
  const remainingWindowHandler = createAppContentWindowClosedHandler({
    app,
    platform: "win32",
    windowManager: { getAppContentWindows: () => [{}], getIsQuitting: () => false },
  });
  const alreadyQuittingHandler = createAppContentWindowClosedHandler({
    app,
    platform: "win32",
    windowManager: { getAppContentWindows: () => [], getIsQuitting: () => true },
  });

  assert.equal(macHandler(), false);
  assert.equal(remainingWindowHandler(), false);
  assert.equal(alreadyQuittingHandler(), false);
  assert.equal(quitCalls, 0);
});
