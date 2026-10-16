/** Tab ids targeted by keyboard tab navigation shortcuts. */
export function buildNumberShortcutTabTargets(params: {
  showSftpTab: boolean;
  shellOnlyTabNumberShortcuts: boolean;
  orderedTabs: readonly string[];
  editorTabIds: readonly string[];
}): string[] {
  const workTabs = [...new Set([...params.orderedTabs, ...params.editorTabIds])];
  if (params.shellOnlyTabNumberShortcuts) {
    return workTabs;
  }
  const pinnedTabs = params.showSftpTab ? ['vault', 'sftp'] : ['vault'];
  return [...new Set([...pinnedTabs, ...workTabs])];
}

/**
 * Maps tab ids to Cmd/Ctrl+[1...9] shortcut indices (1-based).
 * Only the first nine shortcut targets receive a number.
 */
export function buildTabShortcutNumberById(params: {
  showSftpTab: boolean;
  shellOnlyTabNumberShortcuts: boolean;
  orderedTabs: readonly string[];
  editorTabIds: readonly string[];
}): ReadonlyMap<string, number> {
  const targets = buildNumberShortcutTabTargets(params);
  const map = new Map<string, number>();
  const limit = Math.min(9, targets.length);
  for (let index = 0; index < limit; index += 1) {
    map.set(targets[index], index + 1);
  }
  return map;
}
