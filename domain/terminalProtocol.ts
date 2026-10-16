import type { Host, HostProtocol } from './models';

type TerminalTransportHost = Pick<Host, 'protocol' | 'moshEnabled' | 'etEnabled'>
  & Partial<Pick<Host, 'hostname'>>;

/** Resolve the transport actually selected by the first-party session launcher. */
export function resolveEffectiveTerminalProtocol(host: TerminalTransportHost): HostProtocol {
  if (host.protocol && host.protocol !== 'ssh') return host.protocol;
  if (host.moshEnabled) return 'mosh';
  if (host.etEnabled) return 'et';
  if (host.hostname === 'localhost') return 'local';
  return host.protocol ?? 'ssh';
}
