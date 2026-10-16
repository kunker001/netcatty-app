"use strict";

const path = require("node:path");
const { pathToFileURL } = require("node:url");

const MODULE_SPECIFIER_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const MODULE_ENTRY_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;

function normalizePluginModuleResources(resources) {
  if (!Array.isArray(resources) || resources.length < 1 || resources.length > 32) {
    throw new TypeError("Plugin host module resources must contain between 1 and 32 entries");
  }
  const specifiers = new Set();
  return Object.freeze(resources.map((resource, index) => {
    if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
      throw new TypeError("Plugin host module resource must be an object");
    }
    const { specifier, directory, entry = "index.js" } = resource;
    if (typeof specifier !== "string" || !MODULE_SPECIFIER_PATTERN.test(specifier)) {
      throw new TypeError(`Invalid plugin host module specifier: ${String(specifier)}`);
    }
    if (specifiers.has(specifier)) throw new Error(`Duplicate plugin host module specifier: ${specifier}`);
    specifiers.add(specifier);
    if (typeof directory !== "string" || !path.isAbsolute(directory)) {
      throw new TypeError(`Plugin host module directory must be absolute: ${specifier}`);
    }
    if (typeof entry !== "string" || !MODULE_ENTRY_PATTERN.test(entry) || entry.includes("\\")) {
      throw new TypeError(`Invalid plugin host module entry: ${specifier}`);
    }
    return Object.freeze({ directory, entry, route: `m${index}`, specifier });
  }));
}

function createDefaultPluginModuleResources(appRoot, additional = []) {
  return normalizePluginModuleResources([
    {
      specifier: "@netcatty/plugin-sdk",
      directory: path.join(appRoot, "node_modules", "@netcatty", "plugin-sdk", "dist"),
    },
    {
      specifier: "@netcatty/plugin-contract",
      directory: path.join(appRoot, "node_modules", "@netcatty", "plugin-contract", "dist"),
    },
    ...additional,
  ]);
}

function createUtilityModuleMappings(resources) {
  return Object.freeze(Object.fromEntries(resources.map((resource) => [
    resource.specifier,
    pathToFileURL(path.join(resource.directory, ...resource.entry.split("/"))).href,
  ])));
}

module.exports = {
  createDefaultPluginModuleResources,
  createUtilityModuleMappings,
  normalizePluginModuleResources,
};
