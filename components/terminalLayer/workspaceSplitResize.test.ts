import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeResizeBoundary,
  computeSplitSizesFromDelta,
  patchWorkspaceSplitSizes,
  type WorkspaceResizeSession,
} from './workspaceSplitResize';
import type { Workspace } from '../../types';

const session: WorkspaceResizeSession = {
  workspaceId: 'ws-1',
  splitId: 'split-1',
  index: 0,
  direction: 'horizontal',
  startSizes: [0.5, 0.5],
  startArea: { x: 0, y: 0, w: 800, h: 600 },
  startClient: { x: 0, y: 300 },
};

test('computeSplitSizesFromDelta keeps normalized sizes', () => {
  const sizes = computeSplitSizesFromDelta(session, 60);
  assert.equal(sizes.length, 2);
  assert.ok(Math.abs(sizes[0] + sizes[1] - 1) < 0.0001);
  assert.ok(sizes[0] > 0.5);
});

test('computeResizeBoundary moves down when dragging split divider downward', () => {
  const base = computeResizeBoundary(session, 0);
  const moved = computeResizeBoundary(session, 80);
  assert.ok(base != null && moved != null);
  assert.ok(moved > base);
});

test('patchWorkspaceSplitSizes updates only the targeted split node', () => {
  const workspace: Workspace = {
    id: 'ws-1',
    title: 'ws-1',
    root: {
      id: 'split-1',
      type: 'split',
      direction: 'horizontal',
      sizes: [0.5, 0.5],
      children: [
        { id: 'pane-a', type: 'pane', sessionId: 'a' },
        { id: 'pane-b', type: 'pane', sessionId: 'b' },
      ],
    },
  };
  const next = patchWorkspaceSplitSizes(workspace, 'split-1', [0.7, 0.3]);
  assert.notEqual(next, workspace);
  assert.deepEqual(next.root.type === 'split' ? next.root.sizes : null, [0.7, 0.3]);
});
