/**
 * Pure helpers for plugin cloud-sync sidecars.
 *
 * Sidecars hold user-owned encrypted-sync data that must survive missing or
 * uninstalled plugins: non-secret settings marked `sync: true`, plus optional
 * plugin sync account / CRDT baselines. Secret settings never enter sidecars.
 */

export type PluginSyncSidecarKind = 'settings' | 'account_baseline' | 'crdt_baseline';

export interface PluginSettingFieldDescriptor {
  id: string;
  secret?: boolean;
  sync?: boolean;
  scope?: string;
}

export interface PluginSettingValueRecord {
  pluginId: string;
  settingId: string;
  scope: string;
  scopeId: string;
  value: unknown;
  updatedAt?: number;
}

export interface PluginSyncSidecarEntry {
  pluginId: string;
  kind: PluginSyncSidecarKind;
  key: string;
  value: unknown;
  updatedAt: number;
}

export interface PluginSyncSidecarBundle {
  /** Schema version for the sidecar envelope inside the encrypted payload. */
  version: 1;
  entries: PluginSyncSidecarEntry[];
}

export interface CollectPluginSyncSidecarsInput {
  /** Declared setting fields keyed by plugin ID (from installed manifests when available). */
  declaredSettingsByPlugin: ReadonlyMap<string, readonly PluginSettingFieldDescriptor[]>;
  /** Stored non-secret setting values (from non-cascade plugin_settings rows). */
  storedSettings: readonly PluginSettingValueRecord[];
  /** Existing sidecar rows (account/CRDT baselines and previously synced settings). */
  existingSidecars?: readonly PluginSyncSidecarEntry[];
  now?: number;
}

const SIDECAR_KINDS = new Set<PluginSyncSidecarKind>([
  'settings',
  'account_baseline',
  'crdt_baseline',
]);

export function isPluginSyncSidecarKind(value: unknown): value is PluginSyncSidecarKind {
  return typeof value === 'string' && SIDECAR_KINDS.has(value as PluginSyncSidecarKind);
}

/**
 * Returns true when a setting field may enter cloud sync sidecars.
 * Secrets always fail closed even if a descriptor incorrectly sets sync.
 */
export function isCloudSyncablePluginSetting(
  field: Pick<PluginSettingFieldDescriptor, 'secret' | 'sync'>,
): boolean {
  if (field.secret === true) return false;
  return field.sync === true;
}

function settingsSidecarKey(settingId: string, scope: string, scopeId: string): string {
  return `${settingId}\0${scope}\0${scopeId}`;
}

/**
 * Build the sidecar bundle for the encrypted cloud payload.
 * Missing plugins keep existing sidecar rows; only non-secret sync:true
 * settings from the current store are (re)published under kind "settings".
 */
export function collectPluginSyncSidecars(
  input: CollectPluginSyncSidecarsInput,
): PluginSyncSidecarBundle {
  const now = input.now ?? Date.now();
  const entries: PluginSyncSidecarEntry[] = [];
  const settingsIndex = new Map<string, PluginSyncSidecarEntry>();

  // Preserve non-settings sidecars and previous settings for unknown plugins.
  for (const existing of input.existingSidecars ?? []) {
    if (!existing || typeof existing.pluginId !== 'string' || !isPluginSyncSidecarKind(existing.kind)) {
      continue;
    }
    if (existing.kind !== 'settings') {
      entries.push({
        pluginId: existing.pluginId,
        kind: existing.kind,
        key: String(existing.key),
        value: existing.value,
        updatedAt: Number(existing.updatedAt) || now,
      });
      continue;
    }
    const copy: PluginSyncSidecarEntry = {
      pluginId: existing.pluginId,
      kind: 'settings',
      key: String(existing.key),
      value: existing.value,
      updatedAt: Number(existing.updatedAt) || now,
    };
    settingsIndex.set(`${copy.pluginId}\0${copy.key}`, copy);
  }

  for (const stored of input.storedSettings) {
    if (!stored || typeof stored.pluginId !== 'string' || typeof stored.settingId !== 'string') continue;
    const declared = input.declaredSettingsByPlugin.get(stored.pluginId);
    // Missing plugin: keep any prior settings sidecar rows, do not invent new ones
    // from undeclared storage (could include secret-adjacent values).
    if (!declared) continue;
    const field = declared.find((entry) => entry.id === stored.settingId);
    if (!field || !isCloudSyncablePluginSetting(field)) continue;
    const key = settingsSidecarKey(stored.settingId, stored.scope, stored.scopeId);
    const entry: PluginSyncSidecarEntry = {
      pluginId: stored.pluginId,
      kind: 'settings',
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

/**
 * Merge a remote sidecar bundle into local non-cascade storage without deleting
 * local rows for plugins that are not present on the remote (partial sync safety).
 * Secret settings are never applied even if a malicious remote marks them as settings.
 */
/**
 * Three-way merge for settings sidecars so local resets (absent from local,
 * present in base) propagate instead of being resurrected from base/remote.
 * Non-settings kinds (baselines) still use last-writer-wins union.
 */
export function mergePluginSyncSidecarsThreeWay(params: {
  base: readonly PluginSyncSidecarEntry[];
  local: readonly PluginSyncSidecarEntry[];
  remote: readonly PluginSyncSidecarEntry[];
  /**
   * When set, honor cloud/local conflict policy for settings instead of pure
   * timestamp LWW (preferCloud / preferLocal). Default is smart three-way.
   */
  strategy?: 'smart' | 'preferCloud' | 'preferLocal';
}): PluginSyncSidecarEntry[] {
  const strategy = params.strategy ?? 'smart';
  const keyOf = (entry: PluginSyncSidecarEntry) => `${entry.pluginId}\0${entry.kind}\0${entry.key}`;
  const toMap = (entries: readonly PluginSyncSidecarEntry[]) => {
    const map = new Map<string, PluginSyncSidecarEntry>();
    for (const entry of entries) {
      if (!entry || typeof entry.pluginId !== 'string' || !isPluginSyncSidecarKind(entry.kind)) continue;
      map.set(keyOf(entry), {
        pluginId: entry.pluginId,
        kind: entry.kind,
        key: String(entry.key),
        value: entry.value,
        updatedAt: Number(entry.updatedAt) || 0,
      });
    }
    return map;
  };
  const baseMap = toMap(params.base);
  const localMap = toMap(params.local);
  const remoteMap = toMap(params.remote);
  const allKeys = new Set([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()]);
  const out: PluginSyncSidecarEntry[] = [];

  for (const mapKey of allKeys) {
    const b = baseMap.get(mapKey);
    const l = localMap.get(mapKey);
    const r = remoteMap.get(mapKey);
    const kind = (l?.kind ?? r?.kind ?? b?.kind) as PluginSyncSidecarKind | undefined;
    if (!kind) continue;

    if (kind !== 'settings') {
      // Baselines: LWW between local and remote; always preserve local orphans
      // (device-local CRDT/account merge bases must survive preferCloud).
      if (l && r) {
        if (strategy === 'preferCloud') out.push(r);
        else if (strategy === 'preferLocal') out.push(l);
        else out.push(l.updatedAt >= r.updatedAt ? l : r);
      } else if (l) out.push(l);
      else if (r) out.push(r);
      continue;
    }

    // Settings three-way with optional conflict policy:
    // base+remote, not local → local deleted
    if (b && !l && r) {
      if (strategy === 'preferLocal') continue; // honor local deletion
      if (strategy === 'preferCloud' || r.updatedAt > b.updatedAt) out.push(r);
      continue;
    }
    // base+local, not remote → remote deleted
    if (b && l && !r) {
      if (strategy === 'preferCloud') continue; // honor remote deletion
      if (strategy === 'preferLocal' || l.updatedAt > b.updatedAt) out.push(l);
      continue;
    }
    // both deleted
    if (b && !l && !r) continue;
    // only local / only remote additions — keep local-only so preferCloud does
    // not delete unsynced local settings on the subsequent local apply path.
    if (!b && l && !r) {
      out.push(l);
      continue;
    }
    if (!b && !l && r) {
      out.push(r);
      continue;
    }
    // both sides present (with or without base)
    if (l && r) {
      if (strategy === 'preferCloud') {
        out.push(r);
      } else if (strategy === 'preferLocal') {
        out.push(l);
      } else if (l.updatedAt !== r.updatedAt) {
        out.push(l.updatedAt > r.updatedAt ? l : r);
      } else {
        // Equal timestamps: stable secondary key so devices converge.
        const lTie = JSON.stringify(l.value);
        const rTie = JSON.stringify(r.value);
        out.push(lTie >= rTie ? l : r);
      }
      continue;
    }
    if (l) out.push(l);
    else if (r) out.push(r);
  }

  return out.sort((a, b) => {
    if (a.pluginId !== b.pluginId) return a.pluginId < b.pluginId ? -1 : 1;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

export function mergePluginSyncSidecars(params: {
  local: readonly PluginSyncSidecarEntry[];
  remote: PluginSyncSidecarBundle | null | undefined;
  declaredSettingsByPlugin?: ReadonlyMap<string, readonly PluginSettingFieldDescriptor[]>;
}): PluginSyncSidecarEntry[] {
  const remoteEntries = Array.isArray(params.remote?.entries) ? params.remote.entries : [];
  const merged = new Map<string, PluginSyncSidecarEntry>();

  for (const entry of params.local) {
    if (!entry || typeof entry.pluginId !== 'string' || !isPluginSyncSidecarKind(entry.kind)) continue;
    merged.set(`${entry.pluginId}\0${entry.kind}\0${entry.key}`, {
      pluginId: entry.pluginId,
      kind: entry.kind,
      key: String(entry.key),
      value: entry.value,
      updatedAt: Number(entry.updatedAt) || 0,
    });
  }

  for (const raw of remoteEntries) {
    if (!raw || typeof raw.pluginId !== 'string' || !isPluginSyncSidecarKind(raw.kind)) continue;
    if (raw.kind === 'settings') {
      const declared = params.declaredSettingsByPlugin?.get(raw.pluginId);
      if (declared) {
        // key format: settingId\0scope\0scopeId
        const settingId = String(raw.key).split('\0')[0] ?? '';
        const field = declared.find((entry) => entry.id === settingId);
        if (field && !isCloudSyncablePluginSetting(field)) continue;
      }
    }
    const next: PluginSyncSidecarEntry = {
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

/**
 * Parse a settings sidecar key into setting coordinates.
 */
export function parseSettingsSidecarKey(key: string): {
  settingId: string;
  scope: string;
  scopeId: string;
} | null {
  const parts = String(key).split('\0');
  if (parts.length !== 3) return null;
  const [settingId, scope, scopeId] = parts;
  if (!settingId || !scope || !scopeId) return null;
  return { settingId, scope, scopeId };
}

/**
 * Strip secret settings from an arbitrary sidecar entry list (defense in depth).
 */
export function excludeSecretPluginSettingsFromSidecars(
  entries: readonly PluginSyncSidecarEntry[],
  declaredSettingsByPlugin: ReadonlyMap<string, readonly PluginSettingFieldDescriptor[]>,
): PluginSyncSidecarEntry[] {
  return entries.filter((entry) => {
    if (entry.kind !== 'settings') return true;
    const declared = declaredSettingsByPlugin.get(entry.pluginId);
    if (!declared) return true; // preserve orphaned rows for missing plugins
    const parsed = parseSettingsSidecarKey(entry.key);
    if (!parsed) return false;
    const field = declared.find((item) => item.id === parsed.settingId);
    if (!field) return true;
    return isCloudSyncablePluginSetting(field);
  });
}
