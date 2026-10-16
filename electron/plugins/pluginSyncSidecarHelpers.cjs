"use strict";

/**
 * Pure sidecar collect/merge helpers for the plugin host.
 * Mirrors domain/pluginSyncSidecar.ts so main-process CJS can load without TS.
 */

const SIDECAR_KINDS = new Set(["settings", "account_baseline", "crdt_baseline"]);

function isPluginSyncSidecarKind(value) {
  return typeof value === "string" && SIDECAR_KINDS.has(value);
}

function isCloudSyncablePluginSetting(field) {
  if (!field || field.secret === true) return false;
  return field.sync === true;
}

function settingsSidecarKey(settingId, scope, scopeId) {
  return `${settingId}\0${scope}\0${scopeId}`;
}

function parseSettingsSidecarKey(key) {
  const parts = String(key).split("\0");
  if (parts.length !== 3) return null;
  const [settingId, scope, scopeId] = parts;
  if (!settingId || !scope || !scopeId) return null;
  return { settingId, scope, scopeId };
}

/**
 * Map a settings sidecar key onto the currently declared scope coordinates.
 * Returns null when the declared scope cannot be remapped safely (e.g. host
 * scope without a fresh host id).
 */
function resolveSettingsSidecarTarget(field, parsed) {
  const targetScope = typeof field?.scope === "string" && field.scope.length > 0
    ? field.scope
    : parsed.scope;
  let targetScopeId = parsed.scopeId;
  if (targetScope === "application") {
    targetScopeId = "application";
  } else if (targetScope === "device") {
    // parseSettingsSidecarKey guarantees a non-empty scopeId when parsed is set.
    targetScopeId = parsed.scope === "device" ? parsed.scopeId : "device";
  } else if (targetScope !== parsed.scope) {
    return null;
  }
  return {
    targetScope,
    targetScopeId,
    nextKey: settingsSidecarKey(parsed.settingId, targetScope, targetScopeId),
  };
}

function collectPluginSyncSidecars(input) {
  const now = input.now ?? Date.now();
  const entries = [];
  const settingsIndex = new Map();

  for (const existing of input.existingSidecars ?? []) {
    if (!existing || typeof existing.pluginId !== "string" || !isPluginSyncSidecarKind(existing.kind)) {
      continue;
    }
    if (existing.kind !== "settings") {
      entries.push({
        pluginId: existing.pluginId,
        kind: existing.kind,
        key: String(existing.key),
        value: existing.value,
        updatedAt: Number(existing.updatedAt) || now,
      });
      continue;
    }
    const copy = {
      pluginId: existing.pluginId,
      kind: "settings",
      key: String(existing.key),
      value: existing.value,
      updatedAt: Number(existing.updatedAt) || now,
    };
    settingsIndex.set(`${copy.pluginId}\0${copy.key}`, copy);
  }

  for (const stored of input.storedSettings ?? []) {
    if (!stored || typeof stored.pluginId !== "string" || typeof stored.settingId !== "string") continue;
    const declared = input.declaredSettingsByPlugin.get(stored.pluginId);
    if (!declared) continue;
    const field = declared.find((entry) => entry.id === stored.settingId);
    if (!field || !isCloudSyncablePluginSetting(field)) continue;
    const key = settingsSidecarKey(stored.settingId, stored.scope, stored.scopeId);
    const entry = {
      pluginId: stored.pluginId,
      kind: "settings",
      key,
      value: stored.value,
      updatedAt: Number(stored.updatedAt) || now,
    };
    const mapKey = `${entry.pluginId}\0${entry.key}`;
    const previous = settingsIndex.get(mapKey);
    // Keep a retained sidecar when it is strictly newer than the stored row
    // (e.g. schema-rejected remote apply left sidecar only).
    if (!previous || entry.updatedAt >= previous.updatedAt) {
      settingsIndex.set(mapKey, entry);
    }
  }

  entries.push(...settingsIndex.values());
  entries.sort((a, b) => {
    if (a.pluginId !== b.pluginId) return a.pluginId < b.pluginId ? -1 : 1;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  return { version: 1, entries };
}

function mergePluginSyncSidecars(params) {
  const remoteEntries = Array.isArray(params.remote?.entries) ? params.remote.entries : [];
  const merged = new Map();

  for (const entry of params.local ?? []) {
    if (!entry || typeof entry.pluginId !== "string" || !isPluginSyncSidecarKind(entry.kind)) continue;
    merged.set(`${entry.pluginId}\0${entry.kind}\0${entry.key}`, {
      pluginId: entry.pluginId,
      kind: entry.kind,
      key: String(entry.key),
      value: entry.value,
      updatedAt: Number(entry.updatedAt) || 0,
    });
  }

  for (const raw of remoteEntries) {
    if (!raw || typeof raw.pluginId !== "string" || !isPluginSyncSidecarKind(raw.kind)) continue;
    if (raw.kind === "settings") {
      const declared = params.declaredSettingsByPlugin?.get(raw.pluginId);
      if (declared) {
        const settingId = String(raw.key).split("\0")[0] ?? "";
        const field = declared.find((entry) => entry.id === settingId);
        if (field && !isCloudSyncablePluginSetting(field)) continue;
      }
    }
    const next = {
      pluginId: raw.pluginId,
      kind: raw.kind,
      key: String(raw.key),
      value: raw.value,
      updatedAt: Number(raw.updatedAt) || 0,
    };
    const mapKey = `${next.pluginId}\0${next.kind}\0${next.key}`;
    const previous = merged.get(mapKey);
    if (!previous || next.updatedAt >= previous.updatedAt) {
      merged.set(mapKey, next);
    }
  }

  return [...merged.values()].sort((a, b) => {
    if (a.pluginId !== b.pluginId) return a.pluginId < b.pluginId ? -1 : 1;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

function excludeSecretPluginSettingsFromSidecars(entries, declaredSettingsByPlugin) {
  return entries.filter((entry) => {
    if (entry.kind !== "settings") return true;
    const declared = declaredSettingsByPlugin.get(entry.pluginId);
    if (!declared) return true;
    const parsed = parseSettingsSidecarKey(entry.key);
    if (!parsed) return false;
    const field = declared.find((item) => item.id === parsed.settingId);
    if (!field) return true;
    return isCloudSyncablePluginSetting(field);
  });
}

module.exports = {
  collectPluginSyncSidecars,
  excludeSecretPluginSettingsFromSidecars,
  isCloudSyncablePluginSetting,
  isPluginSyncSidecarKind,
  mergePluginSyncSidecars,
  parseSettingsSidecarKey,
  resolveSettingsSidecarTarget,
  settingsSidecarKey,
};
