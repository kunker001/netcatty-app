import assert from 'node:assert/strict';
import test from 'node:test';

import { vaultViewAreEqual } from '../../components/VaultView.tsx';
import {
  getShellHistorySnapshot,
  publishShellHistorySnapshot,
  subscribeShellHistory,
} from './shellHistoryStore.ts';

const vaultBase = {
  hosts: [],
  keys: [],
  identities: [],
  proxyProfiles: [],
  snippets: [],
  snippetPackages: [],
  notes: [],
  noteGroups: [],
  customGroups: [],
  knownHosts: [],
  connectionLogs: [],
  sessions: [],
  managedSources: [],
  groupConfigs: {},
  terminalThemeId: 'default',
  terminalFontSize: 14,
  navigateToSection: null,
};

test('history-only store updates notify subscribers without failing vault memo', () => {
  const seen: number[] = [];
  const unsub = subscribeShellHistory(() => {
    seen.push(getShellHistorySnapshot().length);
  });

  const first = [{
    id: 'h1',
    command: 'ls',
    hostId: 'host',
    hostLabel: 'host',
    sessionId: 's1',
    timestamp: 1,
  }];
  publishShellHistorySnapshot(first);
  assert.equal(getShellHistorySnapshot().length, 1);
  assert.ok(seen.includes(1));

  // Vault equal stays true for identical vault props (history is not a prop).
  assert.equal(
    vaultViewAreEqual(vaultBase as never, { ...vaultBase } as never),
    true,
  );

  publishShellHistorySnapshot([
    ...first,
    {
      id: 'h2',
      command: 'pwd',
      hostId: 'host',
      hostLabel: 'host',
      sessionId: 's1',
      timestamp: 2,
    },
  ]);
  assert.equal(getShellHistorySnapshot().length, 2);
  assert.equal(
    vaultViewAreEqual(vaultBase as never, { ...vaultBase } as never),
    true,
  );

  unsub();
});
