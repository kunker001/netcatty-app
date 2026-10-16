import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Host, PortForwardingRule } from './models';
import { createPortForwardingRule, duplicatePortForwardingRule, updatePortForwardingRule } from './portForwardingAgentOps';

const host: Host = { id: 'host-1', label: 'Host', hostname: 'host.test', username: 'root', tags: [], os: 'linux' };
const source = {
  label: 'Web', type: 'local', localPort: 8080, bindAddress: '127.0.0.1',
  remoteHost: '127.0.0.1', remotePort: 80, hostId: 'host-1',
};

describe('portForwardingAgentOps', () => {
  it('creates deterministic rules from caller-provided id and time', () => {
    const result = createPortForwardingRule([], [host], source, { id: 'rule-1', now: 123 });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.rule.id, 'rule-1');
    assert.equal(result.value.rule.createdAt, 123);
  });

  it('validates types, ports, hosts, and dynamic forwarding fields', () => {
    assert.equal(createPortForwardingRule([], [host], { ...source, localPort: 0 }, { id: 'x', now: 1 }).ok, false);
    assert.equal(createPortForwardingRule([], [host], { ...source, hostId: 'missing' }, { id: 'x', now: 1 }).ok, false);
    assert.equal(createPortForwardingRule([], [host], { ...source, type: 'invalid' }, { id: 'x', now: 1 }).ok, false);
    for (const protocol of ['telnet', 'local', 'serial'] as const) {
      const unsupportedHost: Host = { ...host, id: `${protocol}-host`, protocol };
      const unsupportedResult = createPortForwardingRule([], [unsupportedHost], {
        ...source, hostId: unsupportedHost.id,
      }, { id: `${protocol}-rule`, now: 1 });
      assert.equal(unsupportedResult.ok, false);
      if (!unsupportedResult.ok) assert.match(unsupportedResult.error, /does not support port forwarding/i);
    }
    const dynamic = createPortForwardingRule([], [host], {
      type: 'dynamic', localPort: 1080, hostId: 'host-1',
    }, { id: 'dynamic-1', now: 1 });
    assert.equal(dynamic.ok, true);
  });

  it('updates without changing identity and duplicates with clean runtime state', () => {
    const rule: PortForwardingRule = {
      id: 'rule-1', label: 'Web', type: 'local', localPort: 8080, bindAddress: '127.0.0.1',
      remoteHost: '127.0.0.1', remotePort: 80, hostId: 'host-1', status: 'active', createdAt: 10,
      error: 'previous warning', lastUsedAt: 9,
    };
    const updated = updatePortForwardingRule([rule], [host], 'rule-1', { localPort: 8081 });
    assert.equal(updated.ok, true);
    if (updated.ok) {
      assert.equal(updated.value.rule.id, 'rule-1');
      assert.equal(updated.value.rule.status, 'inactive');
      assert.equal(updated.value.rule.error, undefined);
      assert.equal(updated.value.rule.lastUsedAt, 9);
    }
    const relabeled = updatePortForwardingRule([rule], [host], 'rule-1', { label: 'Renamed' });
    assert.equal(relabeled.ok, true);
    if (relabeled.ok) {
      assert.equal(relabeled.value.rule.status, 'active');
      assert.equal(relabeled.value.rule.error, 'previous warning');
      assert.equal(relabeled.value.rule.lastUsedAt, 9);
    }
    const duplicated = duplicatePortForwardingRule([rule], [host], 'rule-1', { id: 'rule-2', now: 20 });
    assert.equal(duplicated.ok, true);
    if (duplicated.ok) {
      assert.equal(duplicated.value.rule.status, 'inactive');
      assert.equal(duplicated.value.rule.createdAt, 20);
    }
    const serialHost: Host = { ...host, protocol: 'serial' };
    const rejectedDuplicate = duplicatePortForwardingRule(
      [rule], [serialHost], 'rule-1', { id: 'rule-3', now: 30 },
    );
    assert.equal(rejectedDuplicate.ok, false);
    if (!rejectedDuplicate.ok) assert.match(rejectedDuplicate.error, /does not support port forwarding/i);
  });
});
