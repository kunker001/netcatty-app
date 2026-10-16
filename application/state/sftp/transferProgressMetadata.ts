export function hasNewSourceFingerprint(
  current: string | undefined,
  incoming: string | undefined,
): incoming is string {
  return typeof incoming === "string" && incoming.length > 0 && incoming !== current;
}

/** UI progress floor: match/stay above main-process IPC throttle so we do not
 * re-render React + transfer-center faster than the bridge fans out events. */
export const TRANSFER_PROGRESS_UI_MIN_MS = 400;

export function shouldApplyTransferProgress({
  elapsedMs,
  transferred,
  total,
  currentSourceFingerprint,
  incomingSourceFingerprint,
}: {
  elapsedMs: number;
  transferred: number;
  total: number;
  currentSourceFingerprint?: string;
  incomingSourceFingerprint?: string;
}): boolean {
  return elapsedMs >= TRANSFER_PROGRESS_UI_MIN_MS
    || (total > 0 && transferred >= total)
    || hasNewSourceFingerprint(currentSourceFingerprint, incomingSourceFingerprint);
}

/**
 * Soft-drain concurrent transfers report high-water `transferred` ahead of the
 * contiguous durable offset in `checkpointBytes`. Resume/restart must never
 * claim past a sparse hole — always prefer the bridge contiguous checkpoint.
 */
export function resolveDurableCheckpointBytes(params: {
  transferred: number;
  previousCheckpoint?: number;
  incomingCheckpoint?: number;
  status?: string;
}): number {
  const incoming = Number(params.incomingCheckpoint);
  if (Number.isFinite(incoming) && incoming >= 0) {
    return Math.max(0, Math.trunc(incoming));
  }
  const previous = Number(params.previousCheckpoint);
  const prev = Number.isFinite(previous) && previous >= 0 ? Math.trunc(previous) : 0;
  // While pausing/paused, late high-water progress without a contiguous field
  // must not advance the resume offset past the last durable value.
  if (params.status === "pausing" || params.status === "paused") {
    return prev;
  }
  const transferred = Number(params.transferred);
  if (Number.isFinite(transferred) && transferred >= 0) {
    return Math.max(prev, Math.trunc(transferred));
  }
  return prev;
}
