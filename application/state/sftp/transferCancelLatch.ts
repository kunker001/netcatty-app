/**
 * Process-wide cancel flags for SFTP transfers.
 *
 * Directory walks and stream arms check these so Cancel from the global
 * transfer center still stops work after the React owner unmounts.
 */

const cancelledIds = new Set<string>();
const childIdsByRoot = new Map<string, Set<string>>();

export function markTransferCancelled(taskId: string): void {
  cancelledIds.add(taskId);
}

export function markTransferCancelledTree(rootTaskId: string, childIds: readonly string[] = []): void {
  cancelledIds.add(rootTaskId);
  if (childIds.length === 0) return;
  const recordedChildren = childIdsByRoot.get(rootTaskId) ?? new Set<string>();
  for (const id of childIds) {
    cancelledIds.add(id);
    recordedChildren.add(id);
  }
  childIdsByRoot.set(rootTaskId, recordedChildren);
}

export function clearTransferCancelled(taskId: string): void {
  cancelledIds.delete(taskId);
}

export function clearTransferCancelledTree(rootTaskId: string, childIds: readonly string[] = []): void {
  cancelledIds.delete(rootTaskId);
  for (const id of childIdsByRoot.get(rootTaskId) ?? []) cancelledIds.delete(id);
  for (const id of childIds) cancelledIds.delete(id);
  childIdsByRoot.delete(rootTaskId);
}

/**
 * Release cancellation state after the transfer has fully settled.
 * Returns every related child id, including children no longer present in UI
 * history, so sibling control state can be released from the same tree.
 */
export function settleTransferCancelTree(
  rootTaskId: string,
  childIds: readonly string[] = [],
): string[] {
  const relatedChildIds = [...new Set([
    ...(childIdsByRoot.get(rootTaskId) ?? []),
    ...childIds,
  ])];
  clearTransferCancelledTree(rootTaskId, relatedChildIds);
  return relatedChildIds;
}

export function isTransferCancelledFlag(taskId: string): boolean {
  return cancelledIds.has(taskId);
}

export function isTransferOrRootCancelled(rootTaskId: string, taskId?: string): boolean {
  return cancelledIds.has(rootTaskId) || (!!taskId && cancelledIds.has(taskId));
}

/** Test helper. */
export function resetTransferCancelLatchesForTests(): void {
  cancelledIds.clear();
  childIdsByRoot.clear();
}
