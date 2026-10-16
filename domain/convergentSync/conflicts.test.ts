import test from 'node:test';
import assert from 'node:assert/strict';

import { dotKey } from './clock.ts';
import {
  isConvergentConflictSecret,
  resolveConvergentFieldConflict,
} from './conflicts.ts';
import { createConvergentSyncStateFromPayload } from './payload.ts';
import { applyLegacySyncPayload } from './legacy.ts';
import { materializeConvergentSyncState, mergeConvergentSyncStates } from './state.ts';
import type { SyncPayload } from '../sync.ts';

function payload(label: string): SyncPayload {
  return {
    hosts: [{ id: 'h', label, hostname: 'example.com', port: 22, username: 'root', tags: [], os: 'linux' }],
    keys: [], snippets: [], customGroups: [], syncedAt: 0,
  };
}

test('field conflict resolution writes a causal value over every candidate', () => {
  const basePayload = payload('base');
  const base = createConvergentSyncStateFromPayload(basePayload, 'seed', 1);
  const left = applyLegacySyncPayload(base, basePayload, payload('left'), 'left', 2);
  const right = applyLegacySyncPayload(base, basePayload, payload('right'), 'right', 3);
  const merged = mergeConvergentSyncStates(left, right);
  const conflict = materializeConvergentSyncState(merged).conflicts.find(
    (entry) => entry.address.kind === 'entity-field' && entry.address.field === 'label',
  )!;
  const selected = conflict.candidates.find((candidate) => candidate.value === 'left')!;

  const resolved = resolveConvergentFieldConflict(
    merged,
    conflict,
    dotKey(selected.dot),
    'resolver',
    4,
  );

  assert.equal(materializeConvergentSyncState(resolved).conflicts.length, 0);
  assert.equal(materializeConvergentSyncState(resolved).collections.hosts[0]?.label, 'left');
});

test('secret conflicts are identified from paths and nested candidate keys', () => {
  assert.equal(isConvergentConflictSecret({
    address: { kind: 'entity-field', collection: 'keys', entityId: 'k', field: 'privateKey' },
    candidates: [],
  }), true);
  assert.equal(isConvergentConflictSecret({
    address: { kind: 'entity-field', collection: 'hosts', entityId: 'h', field: 'proxyConfig' },
    candidates: [{
      dot: { deviceId: 'a', counter: 1 },
      hlc: { wallTime: 1, logical: 0 },
      tombstone: false,
      value: { password: 'do-not-render' },
      selected: true,
    }],
  }), true);
  assert.equal(isConvergentConflictSecret({
    address: { kind: 'setting', path: ['ai', 'providers'] },
    candidates: [{
      dot: { deviceId: 'a', counter: 2 },
      hlc: { wallTime: 2, logical: 0 },
      tombstone: false,
      value: [{ id: 'provider-1', credentials: { apiKey: 'nested-do-not-render' } }],
      selected: true,
    }],
  }), true);
});
