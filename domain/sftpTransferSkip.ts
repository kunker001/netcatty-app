/**
 * rsync-style "generator" skip: when size and mtime already match the target,
 * the file does not need to be transferred again.
 *
 * SFTP mtimes are typically second-precision; compare on whole seconds so a
 * local millisecond timestamp does not defeat an otherwise identical remote.
 */

export type TransferMtimeUnit = "ms" | "s";

export interface TransferSkipIdentity {
  size: number;
  lastModified: number;
  /**
   * Preferred: adapters declare the unit. Local fs and Netcatty SFTP stats use
   * milliseconds (`Date` / `mtime * 1000`). Raw ssh2 attrs use seconds.
   * When omitted, a magnitude heuristic is used only as a legacy fallback.
   */
  mtimeUnit?: TransferMtimeUnit;
}

export function normalizeTransferMtimeSeconds(
  lastModified: number,
  mtimeUnit?: TransferMtimeUnit,
): number {
  if (!Number.isFinite(lastModified) || lastModified <= 0) return 0;
  if (mtimeUnit === "ms") return Math.floor(lastModified / 1000);
  if (mtimeUnit === "s") return Math.floor(lastModified);
  // Legacy heuristic: magnitudes at/above 1e10 (~year 2286 as seconds) are ms.
  // Prefer passing mtimeUnit from adapters so early-1970 ms values are exact.
  return lastModified >= 1e10 ? Math.floor(lastModified / 1000) : Math.floor(lastModified);
}

export function isUnchangedTransferCandidate(
  source: TransferSkipIdentity,
  target: TransferSkipIdentity,
): boolean {
  const sourceSize = Number(source.size);
  const targetSize = Number(target.size);
  if (!Number.isFinite(sourceSize) || !Number.isFinite(targetSize)) return false;
  if (sourceSize !== targetSize) return false;
  if (sourceSize < 0 || targetSize < 0) return false;
  const sourceMtime = normalizeTransferMtimeSeconds(source.lastModified, source.mtimeUnit);
  const targetMtime = normalizeTransferMtimeSeconds(target.lastModified, target.mtimeUnit);
  if (sourceMtime <= 0 || targetMtime <= 0) return false;
  return sourceMtime === targetMtime;
}
