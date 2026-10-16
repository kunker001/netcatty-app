/**
 * Monotonic control epoch per transfer id.
 *
 * Pause soft-drain / watchdogs capture an epoch when they start. Resume (or a
 * newer pause) bumps the epoch so every in-flight soft-drain becomes a no-op
 * instead of racing the live stream. Process-global so it survives panel unmount.
 */

const epochs = new Map<string, number>();
// A scalar generation prevents ABA when a settled task id is reused. It does
// not retain task ids, while making every new control round process-unique.
let nextEpoch = 0;

export function getTransferControlEpoch(taskId: string): number {
  return epochs.get(taskId) ?? 0;
}

/** Bump and return the new epoch. Call on intentional Pause and Resume. */
export function bumpTransferControlEpoch(taskId: string): number {
  const next = nextEpoch + 1;
  nextEpoch = next;
  epochs.set(taskId, next);
  return next;
}

export function isTransferControlEpochCurrent(taskId: string, epoch: number): boolean {
  return epochs.get(taskId) === epoch;
}

/** Release control epochs after the transfer tree has fully settled. */
export function settleTransferControlEpochTree(
  rootTaskId: string,
  childIds: readonly string[] = [],
): void {
  epochs.delete(rootTaskId);
  for (const childId of childIds) epochs.delete(childId);
}

/** Test helper. */
export function resetTransferControlEpochsForTests(): void {
  epochs.clear();
  nextEpoch = 0;
}
