"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  assertPluginStorageSegment,
  createPluginPaths,
  isPathInside,
  resolveInstalledVersionDirectory,
} = require("./paths.cjs");

test("plugin paths remain rooted under userData", () => {
  const paths = createPluginPaths(path.resolve("/tmp/netcatty-user-data"));
  assert.equal(paths.database, path.join(paths.root, "plugins.sqlite"));
  assert.equal(
    resolveInstalledVersionDirectory(paths, "com.example.test", "1.0.0"),
    path.join(paths.packages, "com.example.test", "1.0.0"),
  );
  assert.equal(isPathInside(paths.packages, path.join(paths.packages, "child")), true);
  assert.equal(isPathInside(paths.packages, path.join(paths.root, "escape")), false);
});

test("plugin storage segments reject path syntax", () => {
  for (const value of ["", ".", "..", "a/b", "a\\b", "a\0b"]) {
    assert.throws(() => assertPluginStorageSegment(value, "test"));
  }
  assert.equal(assertPluginStorageSegment("com.example.valid", "test"), "com.example.valid");
});
