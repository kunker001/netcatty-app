"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadPreload(environment) {
  const listeners = new Map();
  let exposed;
  const ipcRenderer = {
    invoke(channel) {
      assert.equal(channel, "netcatty-plugin-view:get-environment");
      return Promise.resolve(environment);
    },
    on(channel, listener) { listeners.set(channel, listener); },
    removeListener() {},
  };
  const contextBridge = {
    exposeInMainWorld(name, value) {
      assert.equal(name, "netcattyView");
      exposed = value;
    },
  };
  const source = fs.readFileSync(path.join(__dirname, "runtime", "viewPreload.cjs"), "utf8");
  vm.runInNewContext(source, {
    Object,
    Promise,
    queueMicrotask,
    require(moduleName) {
      if (moduleName === "electron") return { contextBridge, ipcRenderer };
      throw new Error(`Unexpected preload dependency: ${moduleName}`);
    },
  }, { filename: "viewPreload.cjs" });
  return {
    api: exposed,
    emitEnvironment(value) {
      listeners.get("netcatty-plugin-view:environment")?.({}, value);
    },
  };
}

test("custom view environment subscriptions replay the latest host state", async () => {
  const initial = { locale: "en", theme: "light", reducedMotion: false, highContrast: false };
  const next = { ...initial, locale: "zh-CN", theme: "dark" };
  const preload = loadPreload(initial);
  preload.emitEnvironment(next);
  const received = [];

  const subscription = preload.api.onDidChangeEnvironment((value) => received.push(value));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received, [next]);
  subscription.dispose();
});

test("custom view environment subscriptions recover through the host getter", async () => {
  const initial = { locale: "en", theme: "system", reducedMotion: false, highContrast: false };
  const preload = loadPreload(initial);
  const received = [];

  preload.api.onDidChangeEnvironment((value) => received.push(value));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received, [initial]);
});
