import assert from 'node:assert/strict';
import test from 'node:test';

import type { TerminalSession, Workspace } from '../../domain/models';
import { collectSessionIds } from '../../domain/workspace';
import { buildCopiedWorkspace } from './useSessionState';

const session = (id: string, workspaceId?: string): TerminalSession => ({
  id,
  hostId: `host-${id}`,
  hostLabel: `Host ${id}`,
  hostname: `${id}.example.test`,
  username: 'user',
  status: 'connected',
  protocol: 'ssh',
  workspaceId,
});

const wsRoot = {
  id: 'split-1',
  type: 'split' as const,
  direction: 'vertical' as const,
  sizes: [0.6, 0.4],
  children: [
    { id: 'pane-1', type: 'pane' as const, sessionId: 's1' },
    { id: 'pane-2', type: 'pane' as const, sessionId: 's2' },
  ],
};

const sourceWorkspace: Workspace = {
  id: 'ws-src',
  title: 'My Split',
  viewMode: 'split',
  focusedSessionId: 's2',
  focusSessionOrder: ['s1', 's2'],
  root: wsRoot,
};

test('buildCopiedWorkspace clones every session with the new workspace id and inherited cwd', () => {
  const prev = [session('s1', 'ws-src'), session('s2', 'ws-src')];
  const built = buildCopiedWorkspace(sourceWorkspace, prev, {
    newWorkspaceId: 'ws-new',
    sessionIdMap: new Map([['s1', 'n1'], ['s2', 'n2']]),
    perPaneCwd: { s1: '/home/a', s2: '/home/b' },
  });

  assert.ok(built);
  assert.deepEqual(built.newSessions.map(s => s.id), ['n1', 'n2']);
  assert.ok(built.newSessions.every(s => s.workspaceId === 'ws-new'));
  assert.equal(built.newSessions[0].pendingInitialCwd, '/home/a');
  assert.equal(built.newSessions[1].pendingInitialCwd, '/home/b');
});

test('buildCopiedWorkspace rebuilds the tree with new ids and preserves view mode + remapped focus', () => {
  const prev = [session('s1', 'ws-src'), session('s2', 'ws-src')];
  const built = buildCopiedWorkspace(sourceWorkspace, prev, {
    newWorkspaceId: 'ws-new',
    sessionIdMap: new Map([['s1', 'n1'], ['s2', 'n2']]),
  });

  assert.ok(built);
  assert.equal(built.newWorkspace.id, 'ws-new');
  assert.equal(built.newWorkspace.viewMode, 'split');
  assert.equal(built.newWorkspace.title, 'My Split');
  assert.deepEqual(collectSessionIds(built.newWorkspace.root), ['n1', 'n2']);
  assert.equal(built.newWorkspace.focusedSessionId, 'n2');
  assert.deepEqual(built.newWorkspace.focusSessionOrder, ['n1', 'n2']);
  const ids = collectSessionIds(built.newWorkspace.root);
  assert.ok(!ids.includes('s1') && !ids.includes('s2'));
});

test('buildCopiedWorkspace prunes panes whose source session no longer exists', () => {
  const prev = [session('s2', 'ws-src')]; // s1 was closed
  const built = buildCopiedWorkspace(sourceWorkspace, prev, {
    newWorkspaceId: 'ws-new',
    sessionIdMap: new Map([['s1', 'n1'], ['s2', 'n2']]),
  });

  assert.ok(built);
  assert.deepEqual(built.newSessions.map(s => s.id), ['n2']);
  assert.deepEqual(collectSessionIds(built.newWorkspace.root), ['n2']);
  assert.equal(built.newWorkspace.focusedSessionId, 'n2');
  assert.deepEqual(built.newWorkspace.focusSessionOrder, ['n2']);
});

test('buildCopiedWorkspace returns null when no source session survives', () => {
  const built = buildCopiedWorkspace(sourceWorkspace, [], {
    newWorkspaceId: 'ws-new',
    sessionIdMap: new Map([['s1', 'n1'], ['s2', 'n2']]),
  });
  assert.equal(built, null);
});

test('buildCopiedWorkspace routes inherited cwd to localStartDir for local sessions', () => {
  const localSrc: Workspace = {
    id: 'ws-src',
    title: 'Local Split',
    root: {
      id: 'sp', type: 'split', direction: 'vertical',
      children: [
        { id: 'p1', type: 'pane', sessionId: 'l1' },
        { id: 'p2', type: 'pane', sessionId: 'l2' },
      ],
    },
  };
  const local = (id: string): TerminalSession => ({
    id, hostId: `h-${id}`, hostLabel: 'Local', hostname: 'local',
    username: 'user', status: 'connected', protocol: 'local',
    localStartDir: '/', workspaceId: 'ws-src',
  });
  const built = buildCopiedWorkspace(localSrc, [local('l1'), local('l2')], {
    newWorkspaceId: 'ws-new',
    sessionIdMap: new Map([['l1', 'm1'], ['l2', 'm2']]),
    perPaneCwd: { l1: '/home/a', l2: '/home/b' },
  });
  assert.ok(built);
  assert.equal(built.newSessions[0].localStartDir, '/home/a');
  assert.equal(built.newSessions[1].localStartDir, '/home/b');
  assert.equal(built.newSessions[0].pendingInitialCwd, undefined);
});

test('buildCopiedWorkspace prunes multiple dead sessions across a nested tree', () => {
  const nested: Workspace = {
    id: 'ws-src', title: 'Nested',
    root: {
      id: 'r', type: 'split', direction: 'vertical',
      children: [
        { id: 'pa', type: 'pane', sessionId: 'a' },
        {
          id: 'inner', type: 'split', direction: 'horizontal',
          children: [
            { id: 'pb', type: 'pane', sessionId: 'b' },
            { id: 'pc', type: 'pane', sessionId: 'c' },
          ],
        },
      ],
    },
  };
  const s = (id: string): TerminalSession => ({
    id, hostId: `h-${id}`, hostLabel: 'H', hostname: 'h',
    username: 'u', status: 'connected', protocol: 'ssh', workspaceId: 'ws-src',
  });
  // Only 'b' survives; 'a' and 'c' are gone.
  const built = buildCopiedWorkspace(nested, [s('b')], {
    newWorkspaceId: 'ws-new',
    sessionIdMap: new Map([['a', 'na'], ['b', 'nb'], ['c', 'nc']]),
  });
  assert.ok(built);
  assert.deepEqual(built.newSessions.map(x => x.id), ['nb']);
  assert.deepEqual(collectSessionIds(built.newWorkspace.root), ['nb']);
});
