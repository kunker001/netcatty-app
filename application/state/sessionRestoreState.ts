import type { TerminalSession, Workspace } from "../../domain/models";
import {
  buildSessionRestorePayload,
  sanitizeSessionRestorePayload,
  type SessionRestorePayload,
} from "../../domain/sessionRestore";

export type InitialRestoredSessionState = {
  sessions: TerminalSession[];
  workspaces: Workspace[];
  tabOrder: string[];
  activeTabId: string;
};

export function createInitialRestoredSessionState({
  restoreEnabled,
  payload,
}: {
  restoreEnabled: boolean;
  payload: SessionRestorePayload | null;
}): InitialRestoredSessionState {
  if (!restoreEnabled || !payload) {
    return {
      sessions: [],
      workspaces: [],
      tabOrder: [],
      activeTabId: "vault",
    };
  }

  const sanitized = sanitizeSessionRestorePayload(payload);
  return {
    sessions: sanitized.sessions,
    workspaces: sanitized.workspaces,
    tabOrder: sanitized.tabOrder,
    activeTabId: sanitized.activeTabId,
  };
}

export function shouldPersistSessionRestoreState(
  sessions: readonly TerminalSession[],
  workspaces: readonly Workspace[],
  tabOrder: readonly string[],
): boolean {
  return sessions.length > 0 || workspaces.length > 0 || tabOrder.length > 0;
}

export function buildPersistableSessionRestorePayload({
  sessions,
  workspaces,
  tabOrder,
  activeTabId,
  now,
}: {
  sessions: TerminalSession[];
  workspaces: Workspace[];
  tabOrder: string[];
  activeTabId: string;
  now?: number;
}): SessionRestorePayload | null {
  if (!shouldPersistSessionRestoreState(sessions, workspaces, tabOrder)) return null;
  return buildSessionRestorePayload({
    sessions,
    workspaces,
    tabOrder,
    activeTabId,
    now,
  });
}

export function buildAndWriteSessionRestorePayload({
  restoreEnabled = true,
  clearOnEmpty = false,
  sessions,
  workspaces,
  tabOrder,
  activeTabId,
  now,
  storage,
}: {
  restoreEnabled?: boolean;
  clearOnEmpty?: boolean;
  sessions: TerminalSession[];
  workspaces: Workspace[];
  tabOrder: string[];
  activeTabId: string;
  now?: number;
  storage: {
    write(payload: SessionRestorePayload): boolean;
    clear(): void;
  };
}): boolean {
  if (!restoreEnabled) {
    storage.clear();
    return false;
  }
  const payload = buildPersistableSessionRestorePayload({
    sessions,
    workspaces,
    tabOrder,
    activeTabId,
    now,
  });
  if (!payload) {
    if (clearOnEmpty) {
      storage.clear();
    }
    return false;
  }
  return storage.write(payload);
}

/**
 * Decide how to persist an active-tab change without rebuilding sessions.
 *
 * Only the in-memory last full payload is a safe base. Disk/storage may lag
 * behind live sessions (e.g. connect opens a session and activates its tab
 * before the debounced full write lands) — never patch from storage alone.
 *
 * - full: no trusted cache → caller must rebuild from live state
 * - noop: cache already has this activeTabId
 * - patch: cache is trusted; only activeTabId needs updating
 */
export function resolveSessionRestoreActiveTabWrite({
  activeTabId,
  cachedPayload,
}: {
  activeTabId: string;
  cachedPayload: SessionRestorePayload | null;
}): { kind: 'full' } | { kind: 'noop' } | { kind: 'patch'; base: SessionRestorePayload } {
  if (!cachedPayload) return { kind: 'full' };
  if (cachedPayload.activeTabId === activeTabId) return { kind: 'noop' };
  return { kind: 'patch', base: cachedPayload };
}

/**
 * Patch only activeTabId on a trusted in-memory full payload.
 * Call only after resolveSessionRestoreActiveTabWrite returns kind: 'patch'.
 *
 * Returns:
 * - 'patched' when storage was written with a new activeTabId
 * - 'unchanged' when the cached activeTabId already matches
 * - 'missing' when there is no trusted base payload (caller should full-write)
 *
 * Intentionally does NOT fall back to storage.read() — that can pair a new
 * activeTabId with stale sessions and corrupt restore after crash.
 */
export function patchSessionRestoreActiveTabId({
  activeTabId,
  now = Date.now(),
  cachedPayload,
  storage,
}: {
  activeTabId: string;
  now?: number;
  /** In-memory last full payload only — never substitute disk/storage here. */
  cachedPayload: SessionRestorePayload | null;
  storage: {
    write(payload: SessionRestorePayload): boolean;
  };
}): { status: 'patched' | 'unchanged' | 'missing'; payload: SessionRestorePayload | null } {
  const decision = resolveSessionRestoreActiveTabWrite({ activeTabId, cachedPayload });
  if (decision.kind === 'full') {
    return { status: 'missing', payload: null };
  }
  if (decision.kind === 'noop') {
    return { status: 'unchanged', payload: cachedPayload };
  }
  const next: SessionRestorePayload = {
    ...decision.base,
    activeTabId,
    savedAt: now,
  };
  storage.write(next);
  return { status: 'patched', payload: next };
}

export function mergeSessionRestoreCwd(
  payload: SessionRestorePayload,
  sessionId: string,
  cwd: string | null,
): SessionRestorePayload {
  return sanitizeSessionRestorePayload({
    ...payload,
    sessions: payload.sessions.map((session) => {
      if (session.id !== sessionId) return session;
      const { lastCwd: _lastCwd, ...rest } = session;
      return cwd ? { ...rest, lastCwd: cwd } : rest;
    }),
  });
}

export function updateRestoredSessionStatusState<T extends Pick<TerminalSession, "id" | "status" | "restoreState">>(
  sessions: readonly T[],
  sessionId: string,
  status: TerminalSession["status"],
): T[] {
  let changed = false;
  const next = sessions.map((session) => {
    if (session.id !== sessionId) return session;
    const shouldClearRestoreState = status === "connecting" || status === "connected";
    if (session.status === status && (!shouldClearRestoreState || session.restoreState === undefined)) {
      return session;
    }
    changed = true;
    if (!shouldClearRestoreState) return { ...session, status };
    const { restoreState: _restoreState, ...rest } = session;
    return { ...rest, status } as T;
  });
  return changed ? next : sessions as T[];
}
