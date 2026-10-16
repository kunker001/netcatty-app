/** Shared host-key verification payload used across terminal / SFTP / port-forward. */
export type HostKeyInfo = {
  hostname: string;
  port: number;
  keyType: string;
  fingerprint: string;
  publicKey?: string;
  status?: "unknown" | "changed";
  knownHostId?: string;
  knownFingerprint?: string;
};

export type HostKeyVerificationRequest = {
  hostname: string;
  port?: number;
  keyType: string;
  fingerprint: string;
  publicKey?: string;
  status?: "unknown" | "changed";
  knownHostId?: string;
  knownFingerprint?: string;
};

export const toHostKeyInfo = (request: HostKeyVerificationRequest): HostKeyInfo => ({
  hostname: request.hostname,
  port: request.port ?? 22,
  keyType: request.keyType,
  fingerprint: request.fingerprint,
  publicKey: request.publicKey,
  status: request.status,
  knownHostId: request.knownHostId,
  knownFingerprint: request.knownFingerprint,
});
