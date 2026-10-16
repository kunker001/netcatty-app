/** Host-like input for select-host group matching (avoids coupling to full Host). */
export type SelectHostGroupMatchable = {
  id: string;
  group?: string;
  protocol?: string;
};

export type GroupSelectionState = 'none' | 'partial' | 'all';

/** Whether a host belongs to groupPath (exact match or nested under it). */
export function hostMatchesGroupPath(
  host: Pick<SelectHostGroupMatchable, 'group'>,
  groupPath: string,
): boolean {
  const path = groupPath.trim();
  if (!path) return false;
  const group = host.group?.trim() ?? '';
  return group === path || group.startsWith(`${path}/`);
}

/** Collect selectable (non-serial) host ids under a group path, including nested groups. */
export function collectSelectableHostIdsInGroup(
  hosts: SelectHostGroupMatchable[],
  groupPath: string,
): string[] {
  return hosts
    .filter((host) => host.protocol !== 'serial' && hostMatchesGroupPath(host, groupPath))
    .map((host) => host.id);
}

export function getGroupSelectionState(
  selectedHostIds: Iterable<string>,
  groupHostIds: string[],
): GroupSelectionState {
  if (groupHostIds.length === 0) return 'none';
  const selected = selectedHostIds instanceof Set
    ? selectedHostIds
    : new Set(selectedHostIds);
  let matched = 0;
  for (const id of groupHostIds) {
    if (selected.has(id)) matched += 1;
  }
  if (matched === 0) return 'none';
  if (matched === groupHostIds.length) return 'all';
  return 'partial';
}

/**
 * Toggle a set of host ids in the current selection.
 * If every id is already selected, remove them; otherwise add any missing ones.
 */
export function toggleIdsInSelection(
  selectedHostIds: string[],
  idsToToggle: string[],
): string[] {
  if (idsToToggle.length === 0) return [...selectedHostIds];
  const selected = new Set(selectedHostIds);
  const allSelected = idsToToggle.every((id) => selected.has(id));
  if (allSelected) {
    for (const id of idsToToggle) selected.delete(id);
  } else {
    for (const id of idsToToggle) selected.add(id);
  }
  return Array.from(selected);
}
