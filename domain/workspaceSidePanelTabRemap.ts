/**
 * Side-panel chrome is keyed by the top-level work tab id. Merging orphans
 * into a workspace (or dissolving a workspace back to orphans) changes that
 * id, so open-tool / layout / mount maps must be remapped or the panel looks
 * like it was cleared even though the underlying chat still exists.
 */

export type SidePanelTabPromote = {
  kind: 'promote';
  fromTabIds: readonly string[];
  toTabId: string;
  preferredFromTabId?: string | null;
};

export type SidePanelTabDemote = {
  kind: 'demote';
  fromTabId: string;
  toTabIds: readonly string[];
  preferredToTabId?: string | null;
};

export type SidePanelTabRemap = SidePanelTabPromote | SidePanelTabDemote;

function pickPreferredSourceId(
  candidates: readonly string[],
  preferredId: string | null | undefined,
  hasValue: (tabId: string) => boolean,
): string | null {
  if (preferredId && candidates.includes(preferredId) && hasValue(preferredId)) {
    return preferredId;
  }
  for (const tabId of candidates) {
    if (tabId && hasValue(tabId)) return tabId;
  }
  return null;
}

/**
 * Copy an open side-panel entry across a tab-id change without deleting the
 * source key. Keeping the source lets a later detach restore the orphan tab's
 * open state even if demote never runs.
 */
export function remapSidePanelTabMap<T>(
  source: ReadonlyMap<string, T>,
  remap: SidePanelTabRemap,
): Map<string, T> {
  if (remap.kind === 'promote') {
    if (!remap.toTabId || source.has(remap.toTabId)) {
      return source instanceof Map ? source : new Map(source);
    }
    const fromId = pickPreferredSourceId(
      remap.fromTabIds,
      remap.preferredFromTabId,
      (tabId) => source.has(tabId),
    );
    if (!fromId) {
      return source instanceof Map ? source : new Map(source);
    }
    const next = new Map(source);
    next.set(remap.toTabId, source.get(fromId) as T);
    return next;
  }

  if (!remap.fromTabId || !source.has(remap.fromTabId)) {
    return source instanceof Map ? source : new Map(source);
  }
  // After merge we keep member keys around; the workspace tab is still the
  // live chrome the user was editing. Always overwrite the preferred survivor
  // so dissolve does not leave a stale pre-merge member entry in place.
  const preferredTo = remap.preferredToTabId
    && remap.toTabIds.includes(remap.preferredToTabId)
    ? remap.preferredToTabId
    : remap.toTabIds.find(Boolean);
  if (!preferredTo) {
    return source instanceof Map ? source : new Map(source);
  }
  const next = new Map(source);
  next.set(preferredTo, source.get(remap.fromTabId) as T);
  return next;
}

/**
 * Move ownership-sensitive tab maps (e.g. SFTP host/path) across a tab-id
 * change. Unlike {@link remapSidePanelTabMap}, this deletes the source key so
 * portals / transfer owners are not duplicated under both ids.
 */
export function moveSidePanelTabMap<T>(
  source: ReadonlyMap<string, T>,
  remap: SidePanelTabRemap,
): Map<string, T> {
  if (remap.kind === 'promote') {
    if (!remap.toTabId) {
      return source instanceof Map ? source : new Map(source);
    }
    if (source.has(remap.toTabId)) {
      // Destination already owns a mount — drop member clones so only one
      // transfer owner remains visible for the workspace tab.
      let changed = false;
      const next = new Map(source);
      for (const fromId of remap.fromTabIds) {
        if (!fromId || fromId === remap.toTabId || !next.has(fromId)) continue;
        next.delete(fromId);
        changed = true;
      }
      return changed ? next : (source instanceof Map ? source : new Map(source));
    }
    const fromId = pickPreferredSourceId(
      remap.fromTabIds,
      remap.preferredFromTabId,
      (tabId) => source.has(tabId),
    );
    if (!fromId) {
      return source instanceof Map ? source : new Map(source);
    }
    const next = new Map(source);
    next.set(remap.toTabId, source.get(fromId) as T);
    next.delete(fromId);
    return next;
  }

  if (!remap.fromTabId || !source.has(remap.fromTabId)) {
    return source instanceof Map ? source : new Map(source);
  }
  const preferredTo = remap.preferredToTabId
    && remap.toTabIds.includes(remap.preferredToTabId)
    ? remap.preferredToTabId
    : remap.toTabIds.find(Boolean);
  if (!preferredTo) {
    return source instanceof Map ? source : new Map(source);
  }
  const next = new Map(source);
  next.set(preferredTo, source.get(remap.fromTabId) as T);
  next.delete(remap.fromTabId);
  return next;
}

/**
 * Move a tab-owned marker across the same workspace/session remaps as the
 * ownership maps. Markers are not cloned: after a promote or demote, the old
 * tab id must not keep an obsolete lifecycle decision alive.
 */
export function moveSidePanelTabSet(
  source: ReadonlySet<string>,
  remap: SidePanelTabRemap,
  options?: { ownerTabIds?: ReadonlySet<string> },
): Set<string> {
  const next = new Set(source);
  const ownerTabIds = options?.ownerTabIds ?? source;

  if (remap.kind === 'promote') {
    if (ownerTabIds.has(remap.toTabId)) {
      for (const tabId of remap.fromTabIds) next.delete(tabId);
      return next;
    }
    const fromId = pickPreferredSourceId(
      remap.fromTabIds,
      remap.preferredFromTabId,
      (tabId) => ownerTabIds.has(tabId),
    );
    if (fromId && source.has(fromId)) next.add(remap.toTabId);
    if (fromId) next.delete(fromId);
    return next;
  }

  if (!ownerTabIds.has(remap.fromTabId)) return next;
  const preferredTo = remap.preferredToTabId
    && remap.toTabIds.includes(remap.preferredToTabId)
    ? remap.preferredToTabId
    : remap.toTabIds.find(Boolean);
  if (source.has(remap.fromTabId) && preferredTo) next.add(preferredTo);
  next.delete(remap.fromTabId);
  return next;
}

export function remapMountedSidePanelTabIds(
  mountedTabIds: readonly string[],
  remap: SidePanelTabRemap,
): string[] {
  if (remap.kind === 'promote') {
    if (!remap.toTabId || mountedTabIds.includes(remap.toTabId)) {
      return [...mountedTabIds];
    }
    const fromId = pickPreferredSourceId(
      remap.fromTabIds,
      remap.preferredFromTabId,
      (tabId) => mountedTabIds.includes(tabId),
    );
    if (!fromId) return [...mountedTabIds];
    return [...mountedTabIds, remap.toTabId];
  }

  if (!remap.fromTabId || !mountedTabIds.includes(remap.fromTabId)) {
    return [...mountedTabIds];
  }
  const preferredTo = remap.preferredToTabId
    && remap.toTabIds.includes(remap.preferredToTabId)
    ? remap.preferredToTabId
    : remap.toTabIds.find((tabId) => tabId && !mountedTabIds.includes(tabId))
      ?? remap.toTabIds[0];
  if (!preferredTo || mountedTabIds.includes(preferredTo)) {
    return [...mountedTabIds];
  }
  return [...mountedTabIds, preferredTo];
}
