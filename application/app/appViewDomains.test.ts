import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appViewDomainsEqual,
  mergeAppViewDomains,
  type AppViewDomains,
} from './appViewDomains.ts';

test('appViewDomainsEqual is true only when all domain slice refs match', () => {
  const vault = { hosts: [] };
  const terminal = { sessions: [] };
  const chrome = { theme: 'dark' };
  const dialogs = { open: false };
  const mounts = { TerminalLayerMount: null };
  const a: AppViewDomains = { vault, terminal, chrome, dialogs, mounts };
  const b: AppViewDomains = { vault, terminal, chrome, dialogs, mounts };
  assert.equal(appViewDomainsEqual(a, b), true);
  assert.equal(
    appViewDomainsEqual(a, { ...b, terminal: { sessions: [{ id: 'x' }] } }),
    false,
  );
  assert.equal(
    appViewDomainsEqual(a, { ...b, vault: { hosts: [{ id: 'h' }] } }),
    false,
  );
});

test('mergeAppViewDomains flattens domains without shellHistory requirement', () => {
  const merged = mergeAppViewDomains({
    vault: { hosts: [1], notes: [] },
    terminal: { sessions: [2] },
    chrome: { orderedTabs: [] },
    dialogs: { isQuickSwitcherOpen: false },
    mounts: { VaultViewContainer: 'V' },
  });
  assert.deepEqual(merged.hosts, [1]);
  assert.deepEqual(merged.sessions, [2]);
  assert.equal(merged.VaultViewContainer, 'V');
  assert.equal(Object.prototype.hasOwnProperty.call(merged, 'shellHistory'), false);
});

test('appViewDomainsEqual keeps AppView stable when only unrelated domain ref is same', () => {
  const vault = { hosts: [] };
  const terminal = { sessions: [] };
  const chrome = { theme: 'dark' };
  const dialogs = { open: false };
  const mounts = { TerminalLayerMount: null };
  const base: AppViewDomains = { vault, terminal, chrome, dialogs, mounts };
  // Same domain refs → equal (title churn must not replace these refs).
  assert.equal(appViewDomainsEqual(base, { vault, terminal, chrome, dialogs, mounts }), true);
  // Terminal domain identity change (structural session change) → unequal.
  assert.equal(
    appViewDomainsEqual(base, { vault, terminal: { sessions: [] }, chrome, dialogs, mounts }),
    false,
  );
});
