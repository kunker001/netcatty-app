import type { TransferTask } from "./models";

export type SftpTransferNavigationTarget = {
  kind: "local-path" | "local-copy-panel" | "remote-host";
  hostId?: string;
  /** When true, open the source path instead of the target path. */
  useSourcePath: boolean;
};

/**
 * Decide which endpoint the global transfer center should open.
 *
 * Resume needs a remote host available for re-auth/reconnect. Opening the
 * destination folder after completion should open the target instead.
 *
 * Important: dual-pane downloads store a real local connection UUID in
 * `targetConnectionId`, not the sentinel `"local"`. Prefer direction + host
 * ids over connection-id string equality alone.
 *
 * Uploads always target a remote host even when `targetHostId` is missing
 * (older rows / drag-drop without a vault id) — never treat a remote path as
 * a local `openPath` target.
 */
export function resolveSftpTransferNavigationTarget(
  task: Pick<
    TransferTask,
    | "direction"
    | "sourceHostId"
    | "targetHostId"
    | "sourceConnectionId"
    | "targetConnectionId"
    | "sourcePath"
    | "targetPath"
    | "isDirectory"
  >,
  forResume: boolean,
): SftpTransferNavigationTarget {
  const sourceIsRemote = Boolean(task.sourceHostId)
    || (task.direction === "download" || task.direction === "remote-to-remote");
  const targetIsRemote = Boolean(task.targetHostId)
    || task.direction === "upload"
    || task.direction === "remote-to-remote";
  const isLocalCopy = task.direction === "local-copy"
    || (
      task.direction !== "upload"
      && task.direction !== "download"
      && task.direction !== "remote-to-remote"
      && !task.sourceHostId
      && !task.targetHostId
    );

  if (forResume) {
    if (isLocalCopy) {
      return { kind: "local-copy-panel", useSourcePath: false };
    }
    // Prefer the remote source when present (downloads, remote-to-remote).
    // Uploads only have a remote target.
    if (sourceIsRemote && task.direction !== "upload") {
      return { kind: "remote-host", hostId: task.sourceHostId, useSourcePath: true };
    }
    return { kind: "remote-host", hostId: task.targetHostId, useSourcePath: false };
  }

  // Open destination folder: local filesystem for downloads/local-copy;
  // remote SFTP panel for uploads and server-to-server targets.
  if (task.direction === "upload" || task.direction === "remote-to-remote" || targetIsRemote) {
    return { kind: "remote-host", hostId: task.targetHostId, useSourcePath: false };
  }
  return { kind: "local-path", useSourcePath: false };
}

export function resolveSftpTransferNavigationPath(
  task: Pick<TransferTask, "sourcePath" | "targetPath" | "isDirectory">,
  useSourcePath: boolean,
): string {
  const rawPath = useSourcePath ? task.sourcePath : task.targetPath;
  if (task.isDirectory) return rawPath;
  return rawPath.replace(/[\\/][^\\/]+$/, "") || "/";
}

/** Host label used when `hostId` is missing and we fall back to name matching. */
export function resolveSftpTransferNavigationHostLabel(
  task: Pick<TransferTask, "sourceHostLabel" | "targetHostLabel">,
  useSourcePath: boolean,
): string | undefined {
  return useSourcePath ? task.sourceHostLabel : task.targetHostLabel;
}

/**
 * Top-level tabs that can host the SFTP side panel (session or workspace ids).
 * Vault / full-page SFTP / editor tabs are not valid SFTP side-panel scopes.
 */
export function isTransferNavigationTerminalTabId(tabId: string | null | undefined): boolean {
  if (!tabId) return false;
  if (tabId === "vault" || tabId === "sftp") return false;
  if (tabId.startsWith("editor:")) return false;
  return true;
}

export type TransferNavigationHostLike = {
  id: string;
  label?: string;
  hostname?: string;
  isLocal?: boolean;
};

/**
 * Resolve a vault/session host for open-folder / resume routing.
 * Prefer id, then label/hostname, then optional live SFTP panel hosts
 * (covers drag-drop uploads that never persisted a vault host id).
 */
export function pickHostForTransferNavigation(params: {
  hostId?: string;
  hostLabel?: string;
  vaultHosts: readonly TransferNavigationHostLike[];
  /** Currently open SFTP hosts (active tab first). */
  liveHosts?: readonly TransferNavigationHostLike[];
  /** When true and no id/label match, use the first non-local live host. */
  allowLiveUploadFallback?: boolean;
}): TransferNavigationHostLike | null {
  const needle = (params.hostLabel || "").trim().toLowerCase();
  const matchIn = (hosts: readonly TransferNavigationHostLike[]) => {
    if (params.hostId) {
      const byId = hosts.find((host) => host.id === params.hostId);
      if (byId) return byId;
    }
    if (needle && needle !== "local") {
      const byLabel = hosts.find((host) => {
        const label = (host.label || "").trim().toLowerCase();
        const hostname = (host.hostname || "").trim().toLowerCase();
        return label === needle || hostname === needle;
      });
      if (byLabel) return byLabel;
    }
    return null;
  };

  const fromVault = matchIn(params.vaultHosts);
  if (fromVault) return fromVault;

  const live = params.liveHosts ?? [];
  const fromLive = matchIn(live);
  if (fromLive) return fromLive;

  if (params.allowLiveUploadFallback) {
    const openRemote = live.find((host) => host && host.isLocal !== true && host.id && host.id !== "local");
    if (openRemote) return openRemote;
  }
  return null;
}
