import { fromEditorTabId, isEditorTabId } from "../state/activeTabStore";

import { applyCustomAccentToTerminalTheme, resolveHostTerminalThemeId } from "../../domain/terminalAppearance";
import type {
  ResolvedAppearance,
  TerminalAppearanceHostScope,
} from "../../domain/terminalAppearanceRuntime";
import { collectSessionIds } from "../../domain/workspace";
import type { EditorTabChrome } from "../state/editorTabStore";
import type { LogView } from "../state/logViewState";
import type { Host, TerminalSession, TerminalTheme, Workspace } from "../../types";
import { resolveWorkspaceTargetSessionFromMap } from "./workTabSurface";

export type ResolveActiveChromeThemeInput = {
  accentMode: "theme" | "custom";
  activeTabId: string;
  currentTerminalTheme: TerminalTheme;
  customAccent: string;
  editorTabs: readonly EditorTabChrome[];
  followAppTerminalTheme: boolean;
  hostById: ReadonlyMap<string, Host>;
  logViews: readonly LogView[];
  resolveSessionAppearance?: (hostScope: TerminalAppearanceHostScope) => ResolvedAppearance;
  sessionById: ReadonlyMap<string, TerminalSession>;
  themeById: ReadonlyMap<string, TerminalTheme>;
  workspaceById: ReadonlyMap<string, Workspace>;
};

export function isActiveChromeThemeResolvable({
  activeTabId,
  editorTabs,
  logViews,
  sessionById,
  workspaceById,
}: Pick<
  ResolveActiveChromeThemeInput,
  "activeTabId" | "editorTabs" | "logViews" | "sessionById" | "workspaceById"
>): boolean {
  if (activeTabId === "vault" || activeTabId === "sftp") return true;
  if (isEditorTabId(activeTabId)) {
    return editorTabs.some((tab) => tab.id === fromEditorTabId(activeTabId));
  }
  if (logViews.some((item) => item.id === activeTabId)) return true;
  if (workspaceById.has(activeTabId)) return true;
  if (sessionById.has(activeTabId)) return true;
  return false;
}

export function resolveActiveChromeTheme({
  accentMode,
  activeTabId,
  currentTerminalTheme,
  customAccent,
  editorTabs,
  followAppTerminalTheme,
  hostById,
  logViews,
  resolveSessionAppearance,
  sessionById,
  themeById,
  workspaceById,
}: ResolveActiveChromeThemeInput): TerminalTheme | null {
  if (activeTabId === "vault" || activeTabId === "sftp") return null;

  const resolveHostScope = (hostId: string): TerminalAppearanceHostScope => {
    const host = hostById.get(hostId) ?? null;
    return { host, isEphemeral: !host || !hostById.has(host.id) };
  };

  const resolveHostTheme = (hostId: string): TerminalTheme => {
    if (followAppTerminalTheme) {
      return applyCustomAccentToTerminalTheme(currentTerminalTheme, accentMode, customAccent);
    }
    if (resolveSessionAppearance) {
      return resolveSessionAppearance(resolveHostScope(hostId)).theme;
    }
    const host = hostById.get(hostId) ?? null;
    const themeId = resolveHostTerminalThemeId(host, currentTerminalTheme.id);
    const baseTheme = themeById.get(themeId) ?? currentTerminalTheme;
    return applyCustomAccentToTerminalTheme(baseTheme, accentMode, customAccent);
  };

  const resolveSessionTheme = (session: TerminalSession): TerminalTheme => resolveHostTheme(session.hostId);

  if (isEditorTabId(activeTabId)) {
    const editorTabId = fromEditorTabId(activeTabId);
    const editorTab = editorTabs.find((tab) => tab.id === editorTabId);
    if (!editorTab) return null;
    return resolveHostTheme(editorTab.hostId);
  }

  const logView = logViews.find((item) => item.id === activeTabId);
  if (logView) {
    const explicitThemeId = logView.log.themeId;
    const base = explicitThemeId ? themeById.get(explicitThemeId) ?? currentTerminalTheme : currentTerminalTheme;
    return applyCustomAccentToTerminalTheme(base, accentMode, customAccent);
  }

  const workspace = workspaceById.get(activeTabId);
  if (workspace) {
    if (followAppTerminalTheme) {
      return applyCustomAccentToTerminalTheme(currentTerminalTheme, accentMode, customAccent);
    }

    if (workspace.viewMode === "focus") {
      const focusedSession = resolveWorkspaceTargetSessionFromMap(workspace, sessionById);
      return focusedSession ? resolveSessionTheme(focusedSession) : null;
    }

    const workspaceSessions = collectSessionIds(workspace.root)
      .map((id) => sessionById.get(id))
      .filter(Boolean) as TerminalSession[];
    if (workspaceSessions.length === 0) return null;

    const firstTheme = resolveSessionTheme(workspaceSessions[0]);
    const allSame = workspaceSessions.every((session) => resolveSessionTheme(session).id === firstTheme.id);
    if (allSame) return firstTheme;

    const focusedSession = resolveWorkspaceTargetSessionFromMap(workspace, sessionById);
    return focusedSession ? resolveSessionTheme(focusedSession) : null;
  }

  const session = sessionById.get(activeTabId);
  return session ? resolveSessionTheme(session) : null;
}
