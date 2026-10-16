import assert from 'node:assert/strict';
import test from 'node:test';
import { handleTrayTogglePortForwardImpl } from './AppHandlers';

const rule = { id: 'rule-1', hostId: 'host-1' };
const host = { id: 'host-1' };

function createContext(options: { requestedStart: boolean; hasRuntimeTunnel: boolean }) {
  const calls = { start: 0, stop: 0 };
  const context = {
    hasRuntimeTunnel: () => options.hasRuntimeTunnel,
    hosts: [host],
    identities: [],
    keys: [],
    knownHosts: [],
    portForwardingRules: [rule],
    resolveEffectiveHost: (value: unknown) => value,
    startTunnel: () => {
      calls.start += 1;
      return Promise.resolve();
    },
    stopTunnel: () => {
      calls.stop += 1;
      return Promise.resolve({ success: true });
    },
    t: (key: string) => key,
    terminalSettings: {},
    toast: { error: () => undefined },
  };

  handleTrayTogglePortForwardImpl(() => context, rule.id, options.requestedStart);
  return calls;
}

test('tray ignores a stale start request when the tunnel is already running', () => {
  const calls = createContext({ requestedStart: true, hasRuntimeTunnel: true });
  assert.deepEqual(calls, { start: 0, stop: 0 });
});

test('tray starts an inactive rule when no runtime tunnel exists', () => {
  const calls = createContext({ requestedStart: true, hasRuntimeTunnel: false });
  assert.deepEqual(calls, { start: 1, stop: 0 });
});

test('tray stop requests remain idempotent', () => {
  const calls = createContext({ requestedStart: false, hasRuntimeTunnel: false });
  assert.deepEqual(calls, { start: 0, stop: 1 });
});
