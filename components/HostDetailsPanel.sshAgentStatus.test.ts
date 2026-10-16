import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./HostDetailsPanel.tsx', import.meta.url), 'utf8');

test('login and forwarding agent availability are checked independently', () => {
  assert.equal(source.match(/let cancelled = false/g)?.length, 2);
  assert.match(source, /if \(!cancelled\) setSshAgentStatus\(status\)/);
  assert.match(source, /if \(!cancelled\) setSshForwardingAgentStatus\(status\)/);
  assert.match(source, /if \(form\.agentForwarding \|\| form\.useSshAgent === true\) \{\s*void checkSshAgent\(\{\s*identityAgent: form\.useSshAgent === true \? form\.identityAgent : undefined,\s*hostname:/);
  assert.match(source, /if \(form\.agentForwarding\) \{\s*void checkSshAgent\(\{\s*identityAgent: form\.identityAgent,\s*agentForwarding: true,/);
  assert.equal(source.match(/return \(\) => \{\s*cancelled = true/g)?.length, 2);
  assert.match(source, /sshForwardingAgentStatus=\{sshForwardingAgentStatus\}/);
});

test('inherited identity actions use the resolved authentication username', () => {
  assert.match(source, /const effectiveAuth = useMemo\(\(\) => resolveHostAuth/);
  assert.match(source, /detachEffectiveHostIdentity\(prev, effectiveAuth\.username\)/);
  assert.match(source, /effectiveUsername=\{effectiveAuth\.username\}/);
});
