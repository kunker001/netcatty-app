/**
 * Idle park TTL for the main-process SSH transport registry
 * (shell / SFTP / transfer / port-forward shared connections).
 * 0 keeps transports warm until app quit or explicit discard (never auto-reclaim).
 * Positive values park for that many ms after the last lease returns.
 */

export const DEFAULT_SSH_TRANSPORT_IDLE_TTL_MS = 5 * 60_000;

export const SSH_TRANSPORT_IDLE_TTL_PRESETS_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  0,
] as const;

export type SshTransportIdleTtlMs = (typeof SSH_TRANSPORT_IDLE_TTL_PRESETS_MS)[number];

export function resolveSshTransportIdleTtlMs(
  readStoredValue: () => number | null | undefined,
): number {
  const stored = readStoredValue();
  if (stored === 0) return 0;
  if (
    typeof stored === "number"
    && Number.isFinite(stored)
    && (SSH_TRANSPORT_IDLE_TTL_PRESETS_MS as readonly number[]).includes(stored)
  ) {
    return stored;
  }
  return DEFAULT_SSH_TRANSPORT_IDLE_TTL_MS;
}
