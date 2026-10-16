import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_SSH_AUTH_READY_TIMEOUT_SECONDS,
  DEFAULT_SSH_TCP_CONNECT_TIMEOUT_SECONDS,
  resolveHostSshConnectionTimeouts,
  sanitizeOptionalSshTimeoutSeconds,
} from './sshConnectionTimeouts.ts';

test('host SSH connection timeouts preserve the existing defaults', () => {
  assert.deepEqual(resolveHostSshConnectionTimeouts({}), {
    tcpConnectTimeoutSeconds: DEFAULT_SSH_TCP_CONNECT_TIMEOUT_SECONDS,
    authReadyTimeoutSeconds: DEFAULT_SSH_AUTH_READY_TIMEOUT_SECONDS,
  });
});

test('host SSH connection timeouts resolve independently per host', () => {
  assert.deepEqual(resolveHostSshConnectionTimeouts({
    sshTcpConnectTimeoutSeconds: 45,
    sshAuthReadyTimeoutSeconds: 300,
  }), {
    tcpConnectTimeoutSeconds: 45,
    authReadyTimeoutSeconds: 300,
  });
});

test('invalid host SSH timeout values fall back or are removed on save', () => {
  assert.deepEqual(resolveHostSshConnectionTimeouts({
    sshTcpConnectTimeoutSeconds: 0,
    sshAuthReadyTimeoutSeconds: Number.NaN,
  }), {
    tcpConnectTimeoutSeconds: DEFAULT_SSH_TCP_CONNECT_TIMEOUT_SECONDS,
    authReadyTimeoutSeconds: DEFAULT_SSH_AUTH_READY_TIMEOUT_SECONDS,
  });
  assert.equal(sanitizeOptionalSshTimeoutSeconds(3601), undefined);
  assert.equal(sanitizeOptionalSshTimeoutSeconds(45.4), 45);
});
