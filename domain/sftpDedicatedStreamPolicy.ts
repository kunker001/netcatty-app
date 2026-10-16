/**
 * Bulk transfers must use dedicated sessions when a remote host is known.
 * Browse sessions are tied to a page and disappear when its terminal tab closes.
 */
export function remoteEndpointRequiresPool(params: {
  isLocal: boolean;
  hostId?: string;
  poolAvailable: boolean;
}): boolean {
  return !params.isLocal && !!params.hostId && params.poolAvailable;
}

export function resolveDedicatedStreamEndpointIds(params: {
  sourceIsLocal: boolean;
  targetIsLocal: boolean;
  sourceHostId?: string;
  targetHostId?: string;
  sourcePoolSftpId?: string;
  targetPoolSftpId?: string;
  panelSourceSftpId?: string | null;
  panelTargetSftpId?: string | null;
  poolAvailable: boolean;
}): { sourceSftpId?: string; targetSftpId?: string; error?: string } {
  const needSource = remoteEndpointRequiresPool({
    isLocal: params.sourceIsLocal,
    hostId: params.sourceHostId,
    poolAvailable: params.poolAvailable,
  });
  const needTarget = remoteEndpointRequiresPool({
    isLocal: params.targetIsLocal,
    hostId: params.targetHostId,
    poolAvailable: params.poolAvailable,
  });

  if (needSource && !params.sourcePoolSftpId) {
    return { error: "Dedicated source transfer session unavailable" };
  }
  if (needTarget && !params.targetPoolSftpId) {
    return { error: "Dedicated target transfer session unavailable" };
  }

  return {
    sourceSftpId: params.sourceIsLocal
      ? undefined
      : (params.sourcePoolSftpId ?? params.panelSourceSftpId ?? undefined),
    targetSftpId: params.targetIsLocal
      ? undefined
      : (params.targetPoolSftpId ?? params.panelTargetSftpId ?? undefined),
  };
}

export function resolveUploadStreamTargetSftpId(params: {
  requirePool: boolean;
  poolSftpId?: string | null;
  prepSftpId?: string | null;
}): { sftpId?: string; error?: string } {
  if (params.requirePool) {
    if (params.poolSftpId) return { sftpId: params.poolSftpId };
    return { error: "Dedicated transfer session unavailable" };
  }
  return { sftpId: params.prepSftpId ?? undefined };
}

export function compressedUploadRequiresDedicatedSession(params: {
  enabled: boolean;
  hasDirectory: boolean;
  isLocal: boolean;
  hostId?: string;
}): boolean {
  return params.enabled && params.hasDirectory && !params.isLocal && !!params.hostId;
}
