import React, { useMemo } from 'react';

import { PluginContributionHost } from '../../components/plugins/PluginContributionHost';
import type { TerminalSession, Workspace } from '../../types';
import { useActiveTabId } from '../state/activeTabStore';
import { resolveActivePluginKeybindingContext } from '../state/pluginContributionContexts';

/**
 * Leaf host for plugin keybindings so AppView does not subscribe to activeTabId.
 * Tab switches only re-render this small surface (and plugin lifecycle), not the shell.
 */
export function AppPluginKeybindingHost({
  locale,
  theme,
  themeTokens,
  sessions,
  workspaces,
}: {
  locale: string;
  theme: string;
  themeTokens?: Record<string, string>;
  sessions: TerminalSession[];
  workspaces: Workspace[];
}) {
  const activeTabId = useActiveTabId();
  const keybindingContext = useMemo(() => resolveActivePluginKeybindingContext({
    activeTabId,
    sessions,
    workspaces,
  }), [activeTabId, sessions, workspaces]);

  return (
    <PluginContributionHost
      locale={locale}
      theme={theme}
      themeTokens={themeTokens}
      keybindingContext={keybindingContext}
    />
  );
}
