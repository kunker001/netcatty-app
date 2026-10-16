import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDurablePluginSyncCredentialRef } from './sync.ts';

test('normalizeDurablePluginSyncCredentialRef accepts durable refs only', () => {
  assert.deepEqual(
    normalizeDurablePluginSyncCredentialRef({ kind: 'secret', id: 's1' }),
    { kind: 'secret', id: 's1' },
  );
  assert.deepEqual(
    normalizeDurablePluginSyncCredentialRef({ kind: 'credential', id: 'c1', key: 'k' }),
    { kind: 'credential', id: 'c1', key: 'k' },
  );
  assert.equal(
    normalizeDurablePluginSyncCredentialRef({ kind: 'secret-lease', id: 'l1' }),
    undefined,
  );
  assert.equal(
    normalizeDurablePluginSyncCredentialRef([{ kind: 'secret', id: 's1' }]),
    undefined,
  );
  assert.equal(normalizeDurablePluginSyncCredentialRef({ kind: 'secret', id: '' }), undefined);
  assert.equal(
    normalizeDurablePluginSyncCredentialRef({ kind: 'secret', id: 'x', key: 1 }),
    undefined,
  );
  assert.equal(
    normalizeDurablePluginSyncCredentialRef({ kind: 'secret', id: 'x'.repeat(513) }),
    undefined,
  );
});
