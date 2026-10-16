"use strict";

const path = require("node:path");

function createPluginPaths(userDataDirectory) {
  if (typeof userDataDirectory !== "string" || !path.isAbsolute(userDataDirectory)) {
    throw new TypeError("Plugin userData directory must be absolute");
  }
  const root = path.join(userDataDirectory, "plugins");
  return Object.freeze({
    root,
    database: path.join(root, "plugins.sqlite"),
    packages: path.join(root, "packages"),
    staging: path.join(root, "staging"),
    data: path.join(root, "data"),
    logs: path.join(root, "logs"),
    dev: path.join(root, "dev"),
  });
}

function assertPluginStorageSegment(value, kind) {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    throw new TypeError(`Invalid plugin ${kind}`);
  }
  if (value === "." || value === ".." || /[\\/\0]/u.test(value)) {
    throw new TypeError(`Unsafe plugin ${kind}`);
  }
  return value;
}

function resolveInstalledVersionDirectory(paths, pluginId, version) {
  return path.join(
    paths.packages,
    assertPluginStorageSegment(pluginId, "ID"),
    assertPluginStorageSegment(version, "version"),
  );
}

function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === ""
    || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

module.exports = {
  assertPluginStorageSegment,
  createPluginPaths,
  isPathInside,
  resolveInstalledVersionDirectory,
};
