import type { Host } from "../../../domain/models";
import type { MutableRefObject } from "react";
import { isSessionError } from "./errors";
import type { SftpPane } from "./types";

export interface SftpSessionProbeBridge {
  realpathSftp?: (sftpId: string, path: string) => Promise<string>;
}

/**
 * Probe the SFTP protocol itself instead of using remote home discovery.
 * Restricted/chroot servers can deny SSH exec or expose '/' as their virtual
 * root while the SFTP session remains fully usable.
 */
export async function probeSftpSession(
  bridge: SftpSessionProbeBridge | null | undefined,
  sftpId: string,
): Promise<boolean> {
  if (!bridge?.realpathSftp) return true;
  await bridge.realpathSftp(sftpId, ".");
  return true;
}

export interface EnsureRemoteSftpSessionParams {
  side: "left" | "right";
  getActivePane: (side: "left" | "right") => SftpPane | null;
  sftpSessionsRef: MutableRefObject<Map<string, string>>;
  lastConnectedHostRef: MutableRefObject<{ left: Host | "local" | null; right: Host | "local" | null }>;
  connect: (
    side: "left" | "right",
    host: Host | "local",
    options?: { initialPath?: string; ignoreSharedCache?: boolean; tabId?: string; sourceSessionId?: string },
  ) => Promise<void>;
  /** Preferred already-authenticated SSH session for this reconnect. */
  sourceSessionId?: string;
  /** Resolve an SSH session after the reconnect host has been resolved. */
  resolveSourceSessionId?: (hostId: string, host: Host) => string | undefined;
  /**
   * Per-tab connect-time host (includes session hostname/port/user overrides).
   * Prefer this over the vault entry so upload reconnects keep the same endpoint.
   */
  resolveConnectedHost?: (tabId: string) => Host | "local" | null | undefined;
  /** Resolve vault host by id when per-tab connect-time host is unavailable. */
  resolveHostById?: (hostId: string) => Host | null | undefined;
  probeSession?: (sftpId: string) => Promise<boolean>;
  /** Remove connection metadata and close the mapped backend session. */
  releaseConnection: (connectionId: string) => Promise<void>;
  forceReconnect?: boolean;
  /** Stable tab identity — reconnect replaces connection ids, not tab ids. */
  tabId?: string;
}

/**
 * Return a live remote SFTP session id for the active pane, reconnecting the
 * host when the mapping is missing or the backend session is gone.
 */
export async function ensureRemoteSftpSession(
  params: EnsureRemoteSftpSessionParams,
): Promise<string> {
  const {
    side,
    getActivePane,
    sftpSessionsRef,
    lastConnectedHostRef,
    connect,
    resolveConnectedHost,
    resolveHostById,
    probeSession,
    releaseConnection,
    forceReconnect = false,
    tabId,
    sourceSessionId,
    resolveSourceSessionId,
  } = params;

  const resolveHost = (): Host => {
    const pane = getActivePane(side);
    const hostId = pane?.connection && !pane.connection.isLocal ? pane.connection.hostId : undefined;
    const resolvedTabId = tabId ?? pane?.id;
    // Prefer the full Host captured when this tab connected (session-time
    // hostname/port/username overrides). Vault lookup by hostId alone would
    // reconnect the base endpoint and can open the wrong server before the
    // upload endpoint assertion aborts.
    if (resolvedTabId && resolveConnectedHost) {
      const fromTab = resolveConnectedHost(resolvedTabId);
      if (fromTab && fromTab !== "local") return fromTab;
    }
    // Vault next — never prefer side-wide lastConnectedHost over vault when
    // another tab on this side may hold different overrides for the same hostId.
    if (hostId && resolveHostById) {
      const fromVault = resolveHostById(hostId);
      if (fromVault) return fromVault;
    }
    const lastHost = lastConnectedHostRef.current[side];
    if (lastHost && lastHost !== "local" && (!hostId || lastHost.id === hostId)) {
      return lastHost;
    }
    // Pane connection only stores hostId/label — inventing root@label:22 would
    // open the wrong endpoint. Fail clearly so the caller can reconnect via
    // vault host metadata instead of a synthetic identity.
    if (pane?.connection && !pane.connection.isLocal) {
      throw new Error(
        `Cannot reconnect SFTP for "${pane.connection.hostLabel}": host credentials are unavailable. Reopen the host from the vault.`,
      );
    }
    throw new Error("No remote host available to reconnect");
  };

  const readMappedId = (): string | undefined => {
    const pane = getActivePane(side);
    if (!pane?.connection || pane.connection.isLocal) {
      throw new Error("No remote SFTP connection on this pane");
    }
    return sftpSessionsRef.current.get(pane.connection.id);
  };

  if (!forceReconnect) {
    const existing = readMappedId();
    if (existing) {
      if (!probeSession) return existing;
      try {
        const ok = await probeSession(existing);
        if (ok) return existing;
      } catch (error) {
        if (!isSessionError(error)) throw error;
      }
      const pane = getActivePane(side);
      if (pane?.connection) {
        await releaseConnection(pane.connection.id);
      }
    }
  } else {
    const pane = getActivePane(side);
    if (pane?.connection) {
      await releaseConnection(pane.connection.id);
    }
  }

  const paneBefore = getActivePane(side);
  const resumePath = paneBefore?.connection?.currentPath;
  const host = resolveHost();
  const resolvedSourceSessionId = sourceSessionId ?? resolveSourceSessionId?.(host.id, host);
  await connect(side, host, {
    initialPath: resumePath,
    ignoreSharedCache: true,
    ...(tabId ? { tabId } : {}),
    ...(resolvedSourceSessionId ? { sourceSessionId: resolvedSourceSessionId } : {}),
  });

  const sftpId = readMappedId();
  if (!sftpId) {
    throw new Error("SFTP session not found after reconnect");
  }
  return sftpId;
}
