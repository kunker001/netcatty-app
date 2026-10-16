import type { Host } from './models.ts';

export const DEFAULT_SSH_TCP_CONNECT_TIMEOUT_SECONDS = 20;
export const DEFAULT_SSH_AUTH_READY_TIMEOUT_SECONDS = 120;
export const MAX_SSH_CONNECTION_TIMEOUT_SECONDS = 3600;

const normalizeTimeoutSeconds = (value: unknown, fallback: number): number => (
  typeof value === 'number'
  && Number.isFinite(value)
  && value >= 1
  && value <= MAX_SSH_CONNECTION_TIMEOUT_SECONDS
    ? Math.round(value)
    : fallback
);

export const sanitizeOptionalSshTimeoutSeconds = (value: unknown): number | undefined => (
  typeof value === 'number'
  && Number.isFinite(value)
  && value >= 1
  && value <= MAX_SSH_CONNECTION_TIMEOUT_SECONDS
    ? Math.round(value)
    : undefined
);

export const resolveHostSshConnectionTimeouts = (
  host: Pick<Host, 'sshTcpConnectTimeoutSeconds' | 'sshAuthReadyTimeoutSeconds'>,
) => ({
  tcpConnectTimeoutSeconds: normalizeTimeoutSeconds(
    host.sshTcpConnectTimeoutSeconds,
    DEFAULT_SSH_TCP_CONNECT_TIMEOUT_SECONDS,
  ),
  authReadyTimeoutSeconds: normalizeTimeoutSeconds(
    host.sshAuthReadyTimeoutSeconds,
    DEFAULT_SSH_AUTH_READY_TIMEOUT_SECONDS,
  ),
});
