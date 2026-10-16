import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { TerminalSession, Workspace } from '../../domain/models';
import { collectSessionIds, type SplitHint } from '../../domain/workspace';
import {
  addTerminalSessionIfMissing,
  addWorkspaceIfMissing,
  appendWorkspaceRootPaneIfMissing,
  insertCopiedTabOrderIdOnce,
  insertWorkspacePaneIfMissing,
} from './useSessionState';

const source = readFileSync(new URL('./useSessionState.ts', import.meta.url), 'utf8');

const session = (id: string, workspaceId?: string): TerminalSession => ({
  id,
  hostId: `host-${id}`,
  hostLabel: `Host ${id}`,
  hostname: `${id}.example.test`,
  username: 'user',
  status: 'connecting',
  workspaceId,
});

const workspace = (id = 'ws-1'): Workspace => ({
  id,
  title: 'Workspace',
  focusedSessionId: 's1',
  root: { id: 'pane-1', type: 'pane', sessionId: 's1' },
});

const paneCount = (ws: Workspace, sessionId: string) => (
  collectSessionIds(ws.root).filter(id => id === sessionId).length
);

test('workspace creation remains idempotent when the same update runs twice', () => {
  const ws = workspace();

  const once = addWorkspaceIfMissing([], ws);
  const twice = addWorkspaceIfMissing(once, ws);

  assert.equal(twice.length, 1);
  assert.equal(twice[0], ws);
});

test('terminal session insertion remains idempotent when the same update runs twice', () => {
  const newSession = session('s2', 'ws-1');

  const once = addTerminalSessionIfMissing([session('s1', 'ws-1')], newSession);
  const twice = addTerminalSessionIfMissing(once, newSession);

  assert.equal(twice.filter(candidate => candidate.id === 's2').length, 1);
});

test('workspace pane insertion remains idempotent when the same update runs twice', () => {
  const hint: SplitHint = {
    direction: 'vertical',
    position: 'right',
    targetSessionId: 's1',
  };

  const once = insertWorkspacePaneIfMissing([workspace()], 'ws-1', 's2', hint);
  const twice = insertWorkspacePaneIfMissing(once, 'ws-1', 's2', hint);

  assert.deepEqual(collectSessionIds(twice[0].root), ['s1', 's2']);
  assert.equal(paneCount(twice[0], 's2'), 1);
});

test('workspace root append remains idempotent when the same update runs twice', () => {
  const once = appendWorkspaceRootPaneIfMissing([workspace()], 'ws-1', 's2', 'vertical');
  const twice = appendWorkspaceRootPaneIfMissing(once, 'ws-1', 's2', 'vertical');

  assert.deepEqual(collectSessionIds(twice[0].root), ['s1', 's2']);
  assert.equal(paneCount(twice[0], 's2'), 1);
  assert.equal(twice[0].focusedSessionId, 's2');
});

test('copied tab order insertion remains idempotent when the same update runs twice', () => {
  const once = insertCopiedTabOrderIdOnce(['s1', 'ws-1'], 's1', 's2', ['s1', 'ws-1']);
  const twice = insertCopiedTabOrderIdOnce(once, 's1', 's2', ['s1', 'ws-1']);

  assert.deepEqual(twice, ['s1', 's2', 'ws-1']);
  assert.equal(twice.filter(id => id === 's2').length, 1);
});

test('insertCopiedTabOrderIdOnce does not duplicate the copied id on the fallback branch', () => {
  // source 'ws-1' is NOT in prevTabOrder -> fallback path; allTabIds lists both ids.
  const result = insertCopiedTabOrderIdOnce([], 'ws-1', 'ws-new', ['ws-1', 'ws-new']);
  assert.equal(result.filter(id => id === 'ws-new').length, 1);
  assert.deepEqual(result, ['ws-1', 'ws-new']);
});

test('workspace host creation paths use the host session snapshot factory', () => {
  assert.match(
    source,
    /createWorkspaceHostTerminalSession\(id,\s*host,\s*workspace\.id\)/,
  );
  assert.match(
    source,
    /return createHostTerminalSession\(crypto\.randomUUID\(\),\s*host\);/,
  );
  assert.match(
    source,
    /createWorkspaceHostTerminalSession\(newSessionId,\s*host,\s*workspaceId\)/,
  );
  assert.doesNotMatch(
    source,
    /if \(host\.protocol === 'serial'\) return null/,
  );
});
