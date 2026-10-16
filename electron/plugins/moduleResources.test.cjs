"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  createUtilityModuleMappings,
  normalizePluginModuleResources,
} = require("./moduleResources.cjs");

test("plugin host modules use deterministic private routes across browser and utility runtimes", () => {
  const resources = normalizePluginModuleResources([
    { specifier: "@netcatty/plugin-sdk", directory: path.resolve("sdk") },
    { specifier: "@netcatty/plugin-ui", directory: path.resolve("ui"), entry: "browser/index.js" },
  ]);
  assert.deepEqual(resources.map(({ route }) => route), ["m0", "m1"]);
  const mappings = createUtilityModuleMappings(resources);
  assert.match(mappings["@netcatty/plugin-sdk"], /sdk\/index\.js$/);
  assert.match(mappings["@netcatty/plugin-ui"], /ui\/browser\/index\.js$/);
  assert.equal(Object.isFrozen(resources), true);
  assert.equal(Object.isFrozen(mappings), true);
});

test("plugin host module resources reject aliases and unsafe entries", () => {
  assert.throws(() => normalizePluginModuleResources([
    { specifier: "@netcatty/plugin-sdk", directory: path.resolve("sdk") },
    { specifier: "@netcatty/plugin-sdk", directory: path.resolve("other") },
  ]), /Duplicate/);
  assert.throws(() => normalizePluginModuleResources([
    { specifier: "@netcatty/plugin-ui", directory: "relative" },
  ]), /must be absolute/);
  assert.throws(() => normalizePluginModuleResources([
    { specifier: "@netcatty/plugin-ui", directory: path.resolve("ui"), entry: "../escape.js" },
  ]), /Invalid/);
  for (const entry of ["dir//index.js", "dir/", "dir\\index.js", ".hidden/index.js"]) {
    assert.throws(() => normalizePluginModuleResources([
      { specifier: "@netcatty/plugin-ui", directory: path.resolve("ui"), entry },
    ]), /Invalid/);
  }
});
