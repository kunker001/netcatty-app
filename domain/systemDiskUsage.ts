export interface MountedDiskUsage {
  capacityKey?: string;
  filesystemType?: string;
  mountPoint: string;
  used: number;
  total: number;
}

export interface AggregatedDiskUsage {
  used: number;
  total: number;
  percent: number;
}

/** Network/FUSE sources that report cloud quotas, not local block capacity. */
export function isNetworkOrFuseCapacityKey(capacityKey: string | undefined): boolean {
  const key = capacityKey?.trim();
  if (!key) return false;
  const lower = key.toLowerCase();
  if (lower === "fuse" || lower.startsWith("fuse.")) return true;
  if (lower === "/dev/fuse" || lower.endsWith("/fuse")) return true;
  if (lower === "rclone" || lower.startsWith("rclone:")) return true;
  if (lower.includes("clouddrive")) return true;
  // CIFS/SMB (`//server/share`) and NFS (`host:/export` or `[ipv6]:/export`).
  // Keep synthetic local keys such as APFS pools and overlay/overlayfs roots
  // out of this heuristic.
  if (lower.startsWith("//")) return true;
  if (
    !lower.startsWith("apfs:")
    && !lower.startsWith("overlay:")
    && !lower.startsWith("overlayfs:")
    && /^([a-z0-9._-]+|\[[0-9a-f:]+(?:%[a-z0-9._-]+)?\]):\//.test(lower)
  ) {
    return true;
  }
  if (
    lower === "sshfs"
    || lower === "s3fs"
    || lower === "gcsfuse"
    || lower === "mergerfs"
    || lower === "unionfs"
    || lower === "unionfs-fuse"
    || lower === "ceph"
    || lower === "ceph-fuse"
    || lower === "cephfs"
    || lower === "gluster"
    || lower === "glusterfs"
    || lower === "ufs"
  ) {
    return true;
  }
  return false;
}

export function isNetworkOrFuseFilesystemType(filesystemType: string | undefined): boolean {
  const type = filesystemType?.trim().toLowerCase();
  if (!type) return false;
  if (type.includes("clouddrive")) return true;
  if (
    /^fuse\.(rclone|sshfs|s3fs|gcsfuse|ufs|mergerfs|unionfs|unionfs-fuse|ceph|ceph-fuse|cephfs|glusterfs)$/
      .test(type)
  ) {
    return true;
  }
  return [
    "fuse",
    "rclone",
    "sshfs",
    "s3fs",
    "gcsfuse",
    "mergerfs",
    "unionfs",
    "unionfs-fuse",
    "nfs",
    "nfs4",
    "cifs",
    "smb",
    "smb3",
    "smbfs",
    "afs",
    "ceph",
    "cephfs",
    "glusterfs",
  ].includes(type);
}

export function aggregateMountedDiskUsage(
  disks: readonly MountedDiskUsage[],
): AggregatedDiskUsage | null {
  const capacityGroups = new Map<string, { used: number; total: number }>();

  for (const disk of disks) {
    if (!Number.isFinite(disk.used) || !Number.isFinite(disk.total)) continue;
    if (disk.used < 0 || disk.total <= 0) continue;
    const filesystemType = disk.filesystemType?.trim();
    const hasFilesystemType = filesystemType && filesystemType !== "-";
    if (hasFilesystemType
      ? isNetworkOrFuseFilesystemType(filesystemType)
      : isNetworkOrFuseCapacityKey(disk.capacityKey)) continue;
    const identity = disk.capacityKey?.trim() || `mount:${disk.mountPoint}`;
    const existing = capacityGroups.get(identity);
    capacityGroups.set(identity, {
      used: Math.max(existing?.used ?? 0, disk.used),
      total: Math.max(existing?.total ?? 0, disk.total),
    });
  }

  let used = 0;
  let total = 0;
  for (const group of capacityGroups.values()) {
    used += group.used;
    total += group.total;
  }

  if (total <= 0) return null;

  return {
    used,
    total,
    percent: Math.max(0, Math.min(100, (used / total) * 100)),
  };
}
