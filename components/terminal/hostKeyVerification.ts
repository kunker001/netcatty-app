import type { Host, KnownHost } from "../../types";
import type { HostKeyInfo } from "../../domain/hostKey";
import { createKnownHostFromHostKeyInfo as createKnownHostFromHostKeyInfoDomain } from "../../domain/knownHosts";

export type { HostKeyInfo, HostKeyVerificationRequest } from "../../domain/hostKey";
export { toHostKeyInfo } from "../../domain/hostKey";

export const createKnownHostFromHostKeyInfo = (
  hostKeyInfo: HostKeyInfo,
  host: Pick<Host, "port">,
  now = Date.now(),
  idSuffix = Math.random().toString(36).slice(2, 11),
): KnownHost => createKnownHostFromHostKeyInfoDomain(hostKeyInfo, {
  defaultPort: host.port,
  now,
  idSuffix,
});
