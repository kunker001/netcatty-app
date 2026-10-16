import type { Workspace, WorkspaceNode } from '../../types';

export type WorkspaceResizeSession = {
  workspaceId: string;
  splitId: string;
  index: number;
  direction: 'vertical' | 'horizontal';
  startSizes: number[];
  startArea: { x: number; y: number; w: number; h: number };
  startClient: { x: number; y: number };
};

function clampAdjacentPaneSizes(
  pxSizes: number[],
  index: number,
  delta: number,
  dimension: number,
): number[] {
  const i = index;
  let a = pxSizes[i] + delta;
  let b = pxSizes[i + 1] - delta;
  const minPx = Math.min(120, dimension / 2);
  if (a < minPx) {
    const diff = minPx - a;
    a = minPx;
    b -= diff;
  }
  if (b < minPx) {
    const diff = minPx - b;
    b = minPx;
    a -= diff;
  }
  const next = [...pxSizes];
  next[i] = Math.max(minPx, a);
  next[i + 1] = Math.max(minPx, b);
  return next;
}

export function computeSplitPxSizesFromDelta(
  session: WorkspaceResizeSession,
  delta: number,
): number[] | null {
  const dimension = session.direction === 'vertical' ? session.startArea.w : session.startArea.h;
  if (dimension <= 0) return null;
  const total = session.startSizes.reduce((acc, n) => acc + n, 0) || 1;
  const pxSizes = session.startSizes.map((s) => (s / total) * dimension);
  return clampAdjacentPaneSizes(pxSizes, session.index, delta, dimension);
}

export function computeSplitSizesFromDelta(
  session: WorkspaceResizeSession,
  delta: number,
): number[] {
  const pxSizes = computeSplitPxSizesFromDelta(session, delta);
  if (!pxSizes) return [...session.startSizes];
  const totalPx = pxSizes.reduce((acc, n) => acc + n, 0) || 1;
  return pxSizes.map((n) => n / totalPx);
}

/** Workspace-local pixel coordinate of the split boundary after applying delta. */
export function computeResizeBoundary(
  session: WorkspaceResizeSession,
  delta: number,
): number | null {
  const pxSizes = computeSplitPxSizesFromDelta(session, delta);
  if (!pxSizes) return null;
  let offset = 0;
  for (let i = 0; i <= session.index; i += 1) {
    offset += pxSizes[i];
  }
  return session.direction === 'vertical'
    ? session.startArea.x + offset
    : session.startArea.y + offset;
}

export function patchWorkspaceSplitSizes(
  workspace: Workspace,
  splitId: string,
  sizes: number[],
): Workspace {
  const patch = (node: WorkspaceNode): WorkspaceNode => {
    if (node.type === 'pane') return node;
    const children = node.children.map(patch);
    if (node.id === splitId) {
      return { ...node, children, sizes: [...sizes] };
    }
    const childrenChanged = children.some((child, idx) => child !== node.children[idx]);
    return childrenChanged ? { ...node, children } : node;
  };
  const root = patch(workspace.root);
  return root === workspace.root ? workspace : { ...workspace, root };
}
