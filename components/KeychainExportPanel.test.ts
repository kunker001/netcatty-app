import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./KeychainExportPanel.tsx', import.meta.url), 'utf8');

test('key export forwards the selected host SSH connection timeouts', () => {
  assert.match(source, /resolveHostSshConnectionTimeouts\(effectiveExportHost\)/);
  assert.match(source, /sshTcpConnectTimeoutMs: connectionTimeouts\.tcpConnectTimeoutSeconds \* 1000/);
  assert.match(source, /sshAuthReadyTimeoutMs: connectionTimeouts\.authReadyTimeoutSeconds \* 1000/);
});

test('key export omits stale identity files for password-only auth', () => {
  assert.match(
    source,
    /fallbackIdentityFilePaths: exportAuth\.authMethod === "password" \|\| exportAuth\.keyId/,
  );
});

test('key export passes the selected vault key to agent filtering', () => {
  assert.match(source, /resolveBridgeSshAgentAuth\(\s*effectiveExportHost,\s*exportAuth\.key,\s*exportAuth\.authMethod,\s*\)/);
});

test('key export defaults blank usernames the same way as other SSH entry points', () => {
  assert.match(source, /username: exportAuth\.username \|\| "root"/);
});

test('key export forwards host MFA metadata to one-off exec commands', () => {
  assert.match(source, /hostId: effectiveExportHost\.id/);
  assert.match(source, /requiresMfa: !!effectiveExportHost\.requiresMfa/);
});
