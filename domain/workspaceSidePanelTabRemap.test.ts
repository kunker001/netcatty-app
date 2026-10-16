import assert from 'node:assert/strict';
import test from 'node:test';

import {
  moveSidePanelTabMap,
  moveSidePanelTabSet,
  remapMountedSidePanelTabIds,
  remapSidePanelTabMap,
} from './workspaceSidePanelTabRemap.ts';

test('promote copies preferred member open tool onto the new workspace tab', () => {
  const source = new Map([
    ['term-a', 'notes'],
    ['term-b', 'sftp'],
  ]);

  assert.deepEqual(
    [...remapSidePanelTabMap(source, {
      kind: 'promote',
      fromTabIds: ['term-a', 'term-b'],
      toTabId: 'ws-1',
      preferredFromTabId: 'term-a',
    })],
    [
      ['term-a', 'notes'],
      ['term-b', 'sftp'],
      ['ws-1', 'notes'],
    ],
  );
});

test('promote copies split layouts onto the new workspace tab', () => {
  const layoutA = { focusedPaneId: 'pane-a', root: { type: 'pane', id: 'pane-a', tool: 'notes' } };
  const layoutB = { focusedPaneId: 'pane-b', root: { type: 'pane', id: 'pane-b', tool: 'sftp' } };
  const source = new Map([
    ['term-a', layoutA],
    ['term-b', layoutB],
  ]);

  const next = remapSidePanelTabMap(source, {
    kind: 'promote',
    fromTabIds: ['term-a', 'term-b'],
    toTabId: 'ws-1',
    preferredFromTabId: 'term-a',
  });

  assert.equal(next.get('ws-1'), layoutA);
  assert.equal(next.get('term-a'), layoutA);
});

test('promote is a no-op when the workspace tab already has an open tool', () => {
  const source = new Map([
    ['term-a', 'notes'],
    ['ws-1', 'notes'],
  ]);

  assert.equal(
    remapSidePanelTabMap(source, {
      kind: 'promote',
      fromTabIds: ['term-a'],
      toTabId: 'ws-1',
      preferredFromTabId: 'term-a',
    }),
    source,
  );
});

test('demote copies workspace open tool onto the preferred orphan tab', () => {
  const source = new Map([
    ['ws-1', 'notes'],
    ['term-b', 'sftp'],
  ]);

  assert.deepEqual(
    [...remapSidePanelTabMap(source, {
      kind: 'demote',
      fromTabId: 'ws-1',
      toTabIds: ['term-a', 'term-b'],
      preferredToTabId: 'term-a',
    })],
    [
      ['ws-1', 'notes'],
      ['term-b', 'sftp'],
      ['term-a', 'notes'],
    ],
  );
});

test('demote overwrites a stale preferred member entry kept from merge', () => {
  const source = new Map([
    ['ws-1', 'notes'],
    ['term-a', 'notes'],
  ]);

  assert.deepEqual(
    [...remapSidePanelTabMap(source, {
      kind: 'demote',
      fromTabId: 'ws-1',
      toTabIds: ['term-a', 'term-b'],
      preferredToTabId: 'term-a',
    })],
    [
      ['ws-1', 'notes'],
      ['term-a', 'notes'],
    ],
  );
});

test('moveSidePanelTabMap promote relocates the source mount onto the workspace tab', () => {
  const source = new Map([
    ['term-a', 'host-a'],
    ['term-b', 'host-b'],
  ]);

  assert.deepEqual(
    [...moveSidePanelTabMap(source, {
      kind: 'promote',
      fromTabIds: ['term-a', 'term-b'],
      toTabId: 'ws-1',
      preferredFromTabId: 'term-a',
    })],
    [
      ['term-b', 'host-b'],
      ['ws-1', 'host-a'],
    ],
  );
});

test('moveSidePanelTabMap demote relocates the workspace mount onto the survivor', () => {
  const source = new Map([
    ['ws-1', 'host-a'],
    ['term-b', 'host-b'],
  ]);

  assert.deepEqual(
    [...moveSidePanelTabMap(source, {
      kind: 'demote',
      fromTabId: 'ws-1',
      toTabIds: ['term-a', 'term-b'],
      preferredToTabId: 'term-a',
    })],
    [
      ['term-b', 'host-b'],
      ['term-a', 'host-a'],
    ],
  );
});

test('moveSidePanelTabSet promotes and demotes the closed-pane marker with ownership', () => {
  const promoted = moveSidePanelTabSet(new Set(['term-b']), {
    kind: 'promote',
    fromTabIds: ['term-a', 'term-b'],
    toTabId: 'ws-1',
    preferredFromTabId: 'term-a',
  });
  assert.deepEqual([...promoted], ['ws-1']);

  const demoted = moveSidePanelTabSet(new Set(['ws-1']), {
    kind: 'demote',
    fromTabId: 'ws-1',
    toTabIds: ['term-a', 'term-b'],
    preferredToTabId: 'term-a',
  });
  assert.deepEqual([...demoted], ['term-a']);
});

test('moveSidePanelTabSet does not bind a marker to a different promoted SFTP owner', () => {
  const marker = moveSidePanelTabSet(new Set(['term-b']), {
    kind: 'promote',
    fromTabIds: ['term-a', 'term-b'],
    toTabId: 'ws-1',
    preferredFromTabId: 'term-a',
  }, { ownerTabIds: new Set(['term-a', 'term-b']) });

  assert.deepEqual([...marker], ['term-b']);

  const preferredMarker = moveSidePanelTabSet(new Set(['term-a']), {
    kind: 'promote',
    fromTabIds: ['term-a', 'term-b'],
    toTabId: 'ws-1',
    preferredFromTabId: 'term-a',
  }, { ownerTabIds: new Set(['term-a', 'term-b']) });
  assert.deepEqual([...preferredMarker], ['ws-1']);

  const nonOwnerDemote = moveSidePanelTabSet(new Set(['term-b']), {
    kind: 'demote',
    fromTabId: 'ws-1',
    toTabIds: ['term-a', 'term-b'],
    preferredToTabId: 'term-a',
  }, { ownerTabIds: new Set(['term-a']) });
  assert.deepEqual([...nonOwnerDemote], ['term-b']);

  const absentMarkerDemote = moveSidePanelTabSet(new Set(), {
    kind: 'demote',
    fromTabId: 'ws-1',
    toTabIds: ['term-a', 'term-b'],
    preferredToTabId: 'term-a',
  }, { ownerTabIds: new Set(['ws-1']) });
  assert.deepEqual([...absentMarkerDemote], []);
});

test('mounted tab ids gain the destination tab when the source was mounted', () => {
  assert.deepEqual(
    remapMountedSidePanelTabIds(['term-a'], {
      kind: 'promote',
      fromTabIds: ['term-a', 'term-b'],
      toTabId: 'ws-1',
      preferredFromTabId: 'term-a',
    }),
    ['term-a', 'ws-1'],
  );

  assert.deepEqual(
    remapMountedSidePanelTabIds(['ws-1'], {
      kind: 'demote',
      fromTabId: 'ws-1',
      toTabIds: ['term-a', 'term-b'],
      preferredToTabId: 'term-a',
    }),
    ['ws-1', 'term-a'],
  );
});
