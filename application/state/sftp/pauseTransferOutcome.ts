/**
 * Shared pause-result classification for panel + global transfer center.
 * Keep panel and store pause UX consistent.
 */

export type PauseBridgeResult = {
  success: boolean;
  reason?: string;
  checkpointBytes?: number;
  resumeStage?: string;
  downloadCheckpointBytes?: number;
  uploadCheckpointBytes?: number;
  sourceFingerprint?: string;
};

/** Backend miss that means "nothing to pause" — not a hard failure. */
export function isBenignPauseMiss(reason?: string): boolean {
  return /no longer active|not found|session/i.test(reason || "");
}

/**
 * Bridge reports the live stream is gone. For a single top-level file this is
 * not a successful pause — Resume must hard-reconnect rather than soft-unpause
 * a dead row painted as "paused".
 */
export function isDeadTransferPauseMiss(reason?: string): boolean {
  return /no longer active|not found/i.test(reason || "");
}

export function isHardPauseFailure(result: PauseBridgeResult | undefined): boolean {
  if (!result) return true;
  if (result.success) return false;
  return !isBenignPauseMiss(result.reason);
}

/**
 * Whether a multi-id pause (directory children or single+children) fully
 * succeeded: every targeted id paused or was already gone.
 */
export function allPauseResultsBenignOrSuccess(
  results: readonly PauseBridgeResult[],
): boolean {
  if (results.length === 0) return true;
  return results.every((result) => result.success || isBenignPauseMiss(result.reason));
}

/** True when every bridge pause miss means the stream is already dead. */
export function allPauseResultsDeadTransfer(
  results: readonly PauseBridgeResult[],
): boolean {
  if (results.length === 0) return false;
  return results.every((result) => !result.success && isDeadTransferPauseMiss(result.reason));
}

export type DirectoryPauseParentOutcome =
  | { kind: "paused"; reason?: string }
  | { kind: "still_transferring"; reason?: string };

/**
 * Parent directory pause outcome after per-child bridge results.
 *
 * Folder pause is latch-first: stop admitting new files even when some child
 * streams refuse pause ("cannot be paused yet", checkpoint verify races).
 * Rolling the parent back to transferring was worse — soft-drained children
 * finished and the queue claimed the next file under a "failed" pause.
 *
 * `reason` may still surface a soft warning on the parent row.
 */
export function resolveDirectoryPauseParentOutcome(
  results: readonly PauseBridgeResult[],
): DirectoryPauseParentOutcome {
  if (allPauseResultsBenignOrSuccess(results)) {
    return { kind: "paused" };
  }
  const hard = results.find((result) => isHardPauseFailure(result));
  return { kind: "paused", reason: hard?.reason };
}

/** Soft/transient pause misses — keep retrying or tolerate for folder latch. */
export function isTransientPauseFailure(reason?: string): boolean {
  return /cannot be paused yet|Could not verify the saved transfer checkpoint|Could not verify that the source is safe to resume/i
    .test(reason || "");
}

/**
 * Whether pauseTransfer should latch waiters (pausedTasksRef).
 * Only latch on true pause success so workers do not soft-deadlock.
 */
export function shouldLatchPauseWaiters(params: {
  pauseSucceeded: boolean;
}): boolean {
  return params.pauseSucceeded;
}

/**
 * After a multi-id pause attempt fails overall, which ids must be unpaused so
 * work can continue (scheduler jobs + successfully bridge-paused streams).
 *
 * `activeIds` — every id we attempted to pause
 * `backendIds` — ids sent to the bridge (scheduler.pause returned false)
 * `bridgeResults` — bridge pause outcomes for backendIds (same order)
 */
export function planPartialPauseRollback(params: {
  activeIds: readonly string[];
  backendIds: readonly string[];
  bridgeResults: readonly PauseBridgeResult[];
}): {
  schedulerIdsToResume: string[];
  bridgeIdsToResume: string[];
} {
  const backendSet = new Set(params.backendIds);
  const schedulerIdsToResume = params.activeIds.filter((id) => !backendSet.has(id));
  const bridgeIdsToResume: string[] = [];
  for (let i = 0; i < params.backendIds.length; i += 1) {
    const result = params.bridgeResults[i];
    if (result?.success) {
      bridgeIdsToResume.push(params.backendIds[i]!);
    }
  }
  return { schedulerIdsToResume, bridgeIdsToResume };
}
