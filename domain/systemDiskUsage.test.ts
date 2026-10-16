import assert from "node:assert/strict";
import test from "node:test";

import { aggregateMountedDiskUsage } from "./systemDiskUsage.ts";

test("aggregateMountedDiskUsage totals every mounted disk", () => {
  assert.deepEqual(
    aggregateMountedDiskUsage([
      { mountPoint: "/", used: 20, total: 100 },
      { mountPoint: "/data", used: 60, total: 300 },
    ]),
    { used: 80, total: 400, percent: 20 },
  );
});

test("aggregateMountedDiskUsage skips rclone/CloudDrive/ufs network FUSE capacities", () => {
  assert.deepEqual(
    aggregateMountedDiskUsage([
      { capacityKey: "/dev/sda1", mountPoint: "/", used: 20, total: 100 },
      { capacityKey: "/dev/sdb1", mountPoint: "/data", used: 10, total: 50 },
      { capacityKey: "fuse.rclone", mountPoint: "/mnt/rclone", used: 500, total: 1000 },
      { capacityKey: "rclone:gdrive:media", mountPoint: "/mnt/gdrive", used: 1000, total: 2000 },
      { capacityKey: "CloudDrive", mountPoint: "/CloudNAS/CloudDrive", used: 2000, total: 4000 },
      { capacityKey: "ufs", mountPoint: "/mnt/ufs", used: 500, total: 1000 },
      { capacityKey: "gdrive:media", filesystemType: "fuse.rclone", mountPoint: "/mnt/remote", used: 800, total: 1600 },
    ]),
    { used: 30, total: 150, percent: 20 },
  );
});

test("aggregateMountedDiskUsage skips NFS/CIFS/SMB and typed mergerfs network mounts", () => {
  assert.deepEqual(
    aggregateMountedDiskUsage([
      { capacityKey: "/dev/sda1", filesystemType: "ext4", mountPoint: "/", used: 20, total: 100 },
      { capacityKey: "nas.local:/volume1/media", filesystemType: "nfs4", mountPoint: "/mnt/nas", used: 8000, total: 20000 },
      { capacityKey: "//nas.local/share", filesystemType: "cifs", mountPoint: "/mnt/smb", used: 4000, total: 10000 },
      { capacityKey: "mergerfs", filesystemType: "fuse.mergerfs", mountPoint: "/mnt/pool", used: 9000, total: 30000 },
      { capacityKey: "union", filesystemType: "mergerfs", mountPoint: "/mnt/union", used: 1000, total: 5000 },
      { capacityKey: "CloudFS", filesystemType: "fuse", mountPoint: "/mnt/CloudNAS/openlist", used: 0, total: 10000 },
      { capacityKey: "gluster", filesystemType: "fuse.glusterfs", mountPoint: "/mnt/gluster", used: 7000, total: 15000 },
      { capacityKey: "ceph-fuse", filesystemType: "fuse.ceph-fuse", mountPoint: "/mnt/ceph", used: 6000, total: 12000 },
      { capacityKey: "unionfs", filesystemType: "fuse.unionfs-fuse", mountPoint: "/mnt/unionfs", used: 2000, total: 8000 },
    ]),
    { used: 20, total: 100, percent: 20 },
  );
});

test("aggregateMountedDiskUsage skips NFS-style sources when filesystem type is unavailable", () => {
  assert.deepEqual(
    aggregateMountedDiskUsage([
      { capacityKey: "/dev/sda1", filesystemType: "-", mountPoint: "/", used: 20, total: 100 },
      { capacityKey: "192.168.1.10:/export", filesystemType: "-", mountPoint: "/mnt/nfs", used: 5000, total: 10000 },
      { capacityKey: "[2001:db8::1]:/export", filesystemType: "-", mountPoint: "/mnt/nfs6", used: 3000, total: 9000 },
      { capacityKey: "[fe80::1%eth0]:/export", filesystemType: "-", mountPoint: "/mnt/nfs6-scoped", used: 3000, total: 9000 },
      { capacityKey: "//filer/backup", filesystemType: "-", mountPoint: "/mnt/cifs", used: 2000, total: 8000 },
      { capacityKey: "ceph-fuse", filesystemType: "-", mountPoint: "/mnt/ceph", used: 6000, total: 12000 },
      { capacityKey: "gluster", filesystemType: "-", mountPoint: "/mnt/gluster", used: 7000, total: 15000 },
    ]),
    { used: 20, total: 100, percent: 20 },
  );
});

test("aggregateMountedDiskUsage keeps fuse-overlayfs and local loop roots", () => {
  assert.deepEqual(
    aggregateMountedDiskUsage([
      { capacityKey: "overlay", filesystemType: "fuse.fuse-overlayfs", mountPoint: "/", used: 4, total: 16 },
    ]),
    { used: 4, total: 16, percent: 25 },
  );
  assert.deepEqual(
    aggregateMountedDiskUsage([
      { capacityKey: "overlayfs:/overlay", mountPoint: "/", used: 0.25, total: 1 },
    ]),
    { used: 0.25, total: 1, percent: 25 },
  );
  assert.deepEqual(
    aggregateMountedDiskUsage([
      { capacityKey: "/dev/loop0", filesystemType: "ext4", mountPoint: "/", used: 3, total: 12 },
    ]),
    { used: 3, total: 12, percent: 25 },
  );
});

test("aggregateMountedDiskUsage trusts a reported local filesystem type over its source name", () => {
  assert.deepEqual(
    aggregateMountedDiskUsage([
      { capacityKey: "ufs", filesystemType: "ext4", mountPoint: "/data", used: 5, total: 10 },
      { capacityKey: "remote:gdrive", filesystemType: "fuse.rclone", mountPoint: "/mnt/gdrive", used: 50, total: 100 },
    ]),
    { used: 5, total: 10, percent: 50 },
  );
});

test("aggregateMountedDiskUsage keeps a local UFS filesystem when its type is reported", () => {
  assert.deepEqual(
    aggregateMountedDiskUsage([
      { capacityKey: "ufs", filesystemType: "ufs", mountPoint: "/data", used: 5, total: 10 },
      { capacityKey: "remote:gdrive", filesystemType: "fuse.rclone", mountPoint: "/mnt/gdrive", used: 50, total: 100 },
    ]),
    { used: 5, total: 10, percent: 50 },
  );
});

test("aggregateMountedDiskUsage keeps a local fuseblk filesystem", () => {
  assert.deepEqual(
    aggregateMountedDiskUsage([
      { capacityKey: "/dev/sdb1", filesystemType: "fuseblk", mountPoint: "/media/ntfs", used: 5, total: 10 },
    ]),
    { used: 5, total: 10, percent: 50 },
  );
});

test("aggregateMountedDiskUsage uses source heuristics when filesystem type is unavailable", () => {
  assert.equal(
    aggregateMountedDiskUsage([
      { capacityKey: "rclone:gdrive", filesystemType: "-", mountPoint: "/mnt/gdrive", used: 50, total: 100 },
    ]),
    null,
  );
});

test("aggregateMountedDiskUsage ignores unusable disk rows", () => {
  assert.deepEqual(
    aggregateMountedDiskUsage([
      { mountPoint: "/", used: 25, total: 100 },
      { mountPoint: "/missing", used: Number.NaN, total: 20 },
      { mountPoint: "/zero", used: 0, total: 0 },
      { mountPoint: "/invalid", used: -1, total: 20 },
    ]),
    { used: 25, total: 100, percent: 25 },
  );
  assert.equal(aggregateMountedDiskUsage([]), null);
});

test("aggregateMountedDiskUsage counts a repeated capacity group only once", () => {
  assert.deepEqual(
    aggregateMountedDiskUsage([
      { capacityKey: "/dev/sda1", mountPoint: "/", used: 20, total: 100 },
      { capacityKey: "/dev/sda1", mountPoint: "/bind-root", used: 20, total: 100 },
      { capacityKey: "/dev/sdb1", mountPoint: "/data", used: 60, total: 300 },
    ]),
    { used: 80, total: 400, percent: 20 },
  );
});

test("aggregateMountedDiskUsage preserves fractional capacity until display formatting", () => {
  assert.deepEqual(
    aggregateMountedDiskUsage([
      { capacityKey: "/dev/sda1", mountPoint: "/", used: 0.125, total: 0.5 },
      { capacityKey: "/dev/sdb1", mountPoint: "/data", used: 0.25, total: 1.5 },
    ]),
    { used: 0.375, total: 2, percent: 18.75 },
  );
});

test("aggregateMountedDiskUsage counts shared APFS container capacity once", () => {
  assert.deepEqual(
    aggregateMountedDiskUsage([
      { capacityKey: "apfs:/dev/disk3", mountPoint: "/Volumes/One", used: 40, total: 500 },
      { capacityKey: "apfs:/dev/disk3", mountPoint: "/Volumes/Two", used: 90, total: 500 },
    ]),
    { used: 90, total: 500, percent: 18 },
  );
});

test("aggregateMountedDiskUsage includes an overfull filesystem", () => {
  assert.deepEqual(
    aggregateMountedDiskUsage([
      { capacityKey: "/dev/sda1", mountPoint: "/", used: 110, total: 100 },
      { capacityKey: "/dev/sdb1", mountPoint: "/data", used: 25, total: 100 },
    ]),
    { used: 135, total: 200, percent: 67.5 },
  );
  assert.deepEqual(
    aggregateMountedDiskUsage([
      { capacityKey: "/dev/sda1", mountPoint: "/", used: 110, total: 100 },
    ]),
    { used: 110, total: 100, percent: 100 },
  );
});
