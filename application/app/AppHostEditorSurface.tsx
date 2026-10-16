import { useMemo } from 'react';

import type { EditorTabChrome } from '../state/editorTabStore';
import type { LogView } from '../state/logViewState';
import type { TerminalSession, Workspace } from '../../types';
import { useActiveTabId } from '../state/activeTabStore';
import { isHostTreeWorkTabSurface } from './workTabSurface';

/**
 * Subscribes to activeTabId and exposes work-surface visibility without
 * forcing the AppView shell to re-render on every top-tab switch.
 */
export function useWorkSurfaceVisible({
  enabled,
  sessions,
  workspaces,
  logViews,
  orderedTabs,
}: {
  enabled: boolean;
  sessions: TerminalSession[];
  workspaces: Workspace[];
  logViews: readonly LogView[];
  orderedTabs: readonly string[];
}): boolean {
  const activeTabId = useActiveTabId();
  const sessionIds = useMemo(
    () => new Set(sessions.map((session) => session.id)),
    [sessions],
  );
  const workspaceIds = useMemo(
    () => new Set(workspaces.map((workspace) => workspace.id)),
    [workspaces],
  );
  const logViewIds = useMemo(
    () => new Set(logViews.map((logView) => logView.id)),
    [logViews],
  );

  return useMemo(() => isHostTreeWorkTabSurface({
    enabled,
    activeTabId,
    logViewIds,
    orderedTabs,
    sessionIds,
    workspaceIds,
  }), [activeTabId, enabled, logViewIds, orderedTabs, sessionIds, workspaceIds]);
}

/** Tiny marker export so tests can pin the isolation helper module. */
export type WorkSurfaceEditorTabChrome = EditorTabChrome;
