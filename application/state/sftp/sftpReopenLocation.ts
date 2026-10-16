export interface SftpRememberedLocation {
  hostId: string;
  connectionKey: string;
  path: string;
}

export function getSftpReopenMemoryKey(params: {
  tabId: string;
  sourceSessionId?: string | null;
}): string {
  return params.sourceSessionId || params.tabId;
}

export function getSftpCurrentPathMemoryKey(params: {
  tabId: string;
  activeTerminalSessionIdForSftp?: string | null;
  focusedSessionId?: string | null;
}): string {
  return params.activeTerminalSessionIdForSftp || params.focusedSessionId || params.tabId;
}

export function resolveSftpOpenLocation(params: {
  hostId: string;
  connectionKey: string;
  terminalCwd?: string;
  explicitTargetPath?: string;
  hasPendingUpload?: boolean;
  remembered?: SftpRememberedLocation | null;
}): string | undefined {
  const { hostId, connectionKey, terminalCwd, explicitTargetPath, hasPendingUpload, remembered } = params;

  if (explicitTargetPath) {
    return explicitTargetPath;
  }

  if (hasPendingUpload) {
    return terminalCwd && terminalCwd.length > 0 ? terminalCwd : undefined;
  }

  if (
    remembered &&
    remembered.hostId === hostId &&
    remembered.connectionKey === connectionKey &&
    remembered.path
  ) {
    return remembered.path;
  }

  return terminalCwd && terminalCwd.length > 0 ? terminalCwd : undefined;
}

/**
 * Path used when the side panel auto-connects / rebinds (not a user open).
 * Prefer an explicit open target, then the last browsed path for this endpoint.
 * Terminal cwd is intentionally omitted here so "follow off" stays sticky;
 * follow mode navigates after connect via the follow sync effect.
 */
export function resolveSftpAutoConnectPath(params: {
  explicitPath?: string | null;
  rememberedPath?: string | null;
}): string | undefined {
  const explicit = params.explicitPath?.length ? params.explicitPath : undefined;
  if (explicit) return explicit;
  const remembered = params.rememberedPath?.length ? params.rememberedPath : undefined;
  return remembered;
}
