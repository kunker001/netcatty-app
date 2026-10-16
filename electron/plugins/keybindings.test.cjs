"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { toElectronAccelerator } = require("./keybindings.cjs");

test("plugin keybindings convert to bounded Electron accelerators", () => {
  assert.equal(toElectronAccelerator("ctrl+shift+h"), "Control+Shift+H");
  assert.equal(toElectronAccelerator("cmd+arrowup"), "Command+Up");
  assert.equal(toElectronAccelerator("mod+enter"), "CommandOrControl+Enter");
  assert.equal(toElectronAccelerator("alt+f12"), "Alt+F12");
  assert.equal(toElectronAccelerator("ctrl+ctrl+h"), undefined);
  assert.equal(toElectronAccelerator("mod+ctrl+h"), undefined);
  assert.equal(toElectronAccelerator("ctrl+not-a-key"), undefined);
  assert.equal(toElectronAccelerator("ctrl+h+g"), undefined);
  assert.equal(toElectronAccelerator("ctrl++p"), undefined);
  assert.equal(toElectronAccelerator("+ctrl+p"), undefined);
  assert.equal(toElectronAccelerator("ctrl+p+"), undefined);
});
