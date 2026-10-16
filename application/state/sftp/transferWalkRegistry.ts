/**
 * Process-global registry of live processTransfer walks (directory or file).
 *
 * Survives SFTP panel / terminal-tab unmount so the global transfer center can
 * soft-resume a still-running walk instead of starting a second dedicated walk.
 */

const inFlightRootIds = new Set<string>();

export function registerTransferWalk(rootTaskId: string): void {
  inFlightRootIds.add(rootTaskId);
}

export function unregisterTransferWalk(rootTaskId: string): void {
  inFlightRootIds.delete(rootTaskId);
}

export function isTransferWalkInFlight(rootTaskId: string): boolean {
  return inFlightRootIds.has(rootTaskId);
}

/** Test helper. */
export function resetTransferWalkRegistryForTests(): void {
  inFlightRootIds.clear();
}

export function listTransferWalksForTests(): string[] {
  return [...inFlightRootIds].sort();
}
