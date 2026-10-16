const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SSH_AUTH_READY_TIMEOUT_MS,
  SSH_TCP_CONNECT_TIMEOUT_MS,
  resolveSshConnectionTimeouts,
} = require("./sshBridge/startSession.cjs");

test("SSH bridge uses default connection timeouts", () => {
  assert.deepEqual(resolveSshConnectionTimeouts({}), {
    tcpConnectTimeoutMs: SSH_TCP_CONNECT_TIMEOUT_MS,
    authReadyTimeoutMs: SSH_AUTH_READY_TIMEOUT_MS,
  });
});

test("SSH bridge accepts valid custom connection timeouts", () => {
  assert.deepEqual(resolveSshConnectionTimeouts({
    sshTcpConnectTimeoutMs: 45_000,
    sshAuthReadyTimeoutMs: 300_000,
  }), {
    tcpConnectTimeoutMs: 45_000,
    authReadyTimeoutMs: 300_000,
  });
});

test("SSH bridge rejects invalid custom connection timeouts", () => {
  assert.deepEqual(resolveSshConnectionTimeouts({
    sshTcpConnectTimeoutMs: 0,
    sshAuthReadyTimeoutMs: 3_600_001,
  }), {
    tcpConnectTimeoutMs: SSH_TCP_CONNECT_TIMEOUT_MS,
    authReadyTimeoutMs: SSH_AUTH_READY_TIMEOUT_MS,
  });
});
