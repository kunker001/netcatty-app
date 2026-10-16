import assert from "node:assert/strict";
import test from "node:test";

import type { TransferTask } from "./models";
import {
  findActivePathConflict,
  pathConflictMessage,
} from "./sftpTransferConflicts";

const base = (overrides: Partial<TransferTask> = {}): TransferTask => ({
  id: "a",
  fileName: "sing-box",
  sourcePath: "/root/sing-box",
  targetPath: "/Users/me/Desktop/sing-box",
  sourceConnectionId: "remote",
  targetConnectionId: "local",
  direction: "download",
  status: "transferring",
  totalBytes: 100,
  transferredBytes: 10,
  speed: 1,
  startTime: 1,
  isDirectory: false,
  ...overrides,
});

test("findActivePathConflict matches same destination among active rows", () => {
  const tasks = [
    base({ id: "live", status: "transferring" }),
    base({ id: "done", status: "completed", transferredBytes: 100 }),
    base({ id: "other-path", targetPath: "/tmp/other" }),
  ];
  assert.equal(
    findActivePathConflict(tasks, {
      id: "new",
      targetPath: "/Users/me/Desktop/sing-box",
      targetConnectionId: "local",
    })?.id,
    "live",
  );
  assert.equal(
    findActivePathConflict(tasks, {
      id: "live",
      targetPath: "/Users/me/Desktop/sing-box",
      targetConnectionId: "local",
    }),
    undefined,
  );
});

test("findActivePathConflict ignores identical paths on different endpoints", () => {
  const tasks = [
    base({
      id: "host-a",
      direction: "upload",
      sourcePath: "/local/file",
      targetPath: "/remote/file",
      sourceConnectionId: "local",
      targetConnectionId: "conn-a",
      targetHostId: "host-a",
    }),
  ];
  assert.equal(
    findActivePathConflict(tasks, {
      id: "host-b",
      targetPath: "/remote/file",
      targetConnectionId: "conn-b",
      targetHostId: "host-b",
    }),
    undefined,
  );
});

test("findActivePathConflict collides different sources writing one destination", () => {
  const tasks = [
    base({
      id: "from-a",
      sourcePath: "/root/a",
      targetPath: "/Users/me/Desktop/out.bin",
    }),
  ];
  assert.equal(
    findActivePathConflict(tasks, {
      id: "from-b",
      targetPath: "/Users/me/Desktop/out.bin",
      targetConnectionId: "local",
    })?.id,
    "from-a",
  );
});

test("findActivePathConflict requires local endpoint on the candidate (downloadToLocal regression)", () => {
  // createDirectDownloadTransferTask stores targetConnectionId:"local".
  // A bare { targetPath } candidate is not isLocalTransferDestination — it
  // used to miss every active download and allow duplicate concurrent writers.
  const tasks = [
    base({
      id: "active-download",
      targetPath: "/Users/me/Downloads/frpc.tar",
      targetConnectionId: "local",
      targetHostLabel: "Local",
      status: "transferring",
    }),
  ];
  assert.equal(
    findActivePathConflict(tasks, {
      id: "broken-candidate",
      targetPath: "/Users/me/Downloads/frpc.tar",
    }),
    undefined,
    "missing local endpoint must not false-match (documents the bug shape)",
  );
  assert.equal(
    findActivePathConflict(tasks, {
      id: "fixed-candidate",
      targetPath: "/Users/me/Downloads/frpc.tar",
      targetConnectionId: "local",
      targetHostLabel: "Local",
    })?.id,
    "active-download",
  );
});

test("findActivePathConflict treats local pane id and local sentinel as one endpoint", () => {
  const tasks = [
    base({
      id: "dual-pane",
      targetConnectionId: "right-1710000000000",
      targetHostLabel: "Local",
    }),
  ];
  assert.equal(
    findActivePathConflict(tasks, {
      id: "save-as",
      targetPath: "/Users/me/Desktop/sing-box",
      targetConnectionId: "local",
    })?.id,
    "dual-pane",
  );
  // Dual-pane enqueue normalizes local candidates to the "local" sentinel + label.
  assert.equal(
    findActivePathConflict(tasks, {
      id: "other-pane",
      targetPath: "/Users/me/Desktop/sing-box",
      targetConnectionId: "local",
      targetHostLabel: "Local",
    })?.id,
    "dual-pane",
  );
  // Two stored dual-pane local rows (ephemeral pane ids) still collide.
  assert.equal(
    findActivePathConflict(
      [
        ...tasks,
        base({
          id: "left-pane",
          targetConnectionId: "left-1710000000001",
          targetHostLabel: "Local",
          status: "pending",
        }),
      ],
      {
        id: "left-pane",
        targetPath: "/Users/me/Desktop/sing-box",
        targetConnectionId: "left-1710000000001",
        targetHostLabel: "Local",
      },
    )?.id,
    "dual-pane",
  );
});

test("interrupted is not an active path conflict (resume may claim the path)", () => {
  const tasks = [base({ id: "dead", status: "interrupted" })];
  assert.equal(
    findActivePathConflict(tasks, {
      id: "resume",
      targetPath: "/Users/me/Desktop/sing-box",
      targetConnectionId: "local",
    }),
    undefined,
  );
});

test("findActivePathConflict includes active directory child transfers", () => {
  const tasks = [
    base({
      id: "dir-parent",
      fileName: "bundle",
      targetPath: "/Users/me/Desktop/bundle",
      isDirectory: true,
      status: "transferring",
    }),
    base({
      id: "dir-child",
      fileName: "out.bin",
      targetPath: "/Users/me/Desktop/bundle/out.bin",
      parentTaskId: "dir-parent",
      status: "transferring",
    }),
  ];
  assert.equal(
    findActivePathConflict(tasks, {
      id: "standalone",
      targetPath: "/Users/me/Desktop/bundle/out.bin",
      targetConnectionId: "local",
    })?.id,
    "dir-child",
  );
  // Parent directory path alone is not the same destination as a nested file.
  assert.equal(
    findActivePathConflict(tasks, {
      id: "standalone-dir",
      targetPath: "/Users/me/Desktop/bundle",
      targetConnectionId: "local",
    })?.id,
    "dir-parent",
  );
});

test("findActivePathConflict reserves descendants of active directory transfers", () => {
  const tasks = [
    base({
      id: "dir-parent",
      fileName: "bundle",
      targetPath: "/Users/me/Desktop/bundle",
      isDirectory: true,
      status: "pending",
    }),
  ];
  assert.equal(
    findActivePathConflict(tasks, {
      id: "standalone",
      targetPath: "/Users/me/Desktop/bundle/out.bin",
      targetConnectionId: "local",
    })?.id,
    "dir-parent",
  );
  assert.equal(
    findActivePathConflict(tasks, {
      id: "sibling-prefix",
      targetPath: "/Users/me/Desktop/bundle-old/out.bin",
      targetConnectionId: "local",
    }),
    undefined,
  );
});

test("findActivePathConflict refuses directory that would cover an active descendant", () => {
  const tasks = [
    base({
      id: "live-file",
      fileName: "out.bin",
      targetPath: "/Users/me/Desktop/bundle/out.bin",
      status: "transferring",
    }),
  ];
  assert.equal(
    findActivePathConflict(tasks, {
      id: "incoming-dir",
      targetPath: "/Users/me/Desktop/bundle",
      targetConnectionId: "local",
      isDirectory: true,
    })?.id,
    "live-file",
  );
  // Without isDirectory, a file-named path does not reserve descendants.
  assert.equal(
    findActivePathConflict(tasks, {
      id: "incoming-file",
      targetPath: "/Users/me/Desktop/bundle",
      targetConnectionId: "local",
      isDirectory: false,
    }),
    undefined,
  );
  assert.equal(
    findActivePathConflict(tasks, {
      id: "sibling-dir",
      targetPath: "/Users/me/Desktop/bundle-old",
      targetConnectionId: "local",
      isDirectory: true,
    }),
    undefined,
  );
});

test("findActivePathConflict compares Windows local paths canonically", () => {
  const tasks = [
    base({
      id: "live",
      targetPath: "C:\\Downloads\\out.bin",
      status: "transferring",
    }),
  ];
  assert.equal(
    findActivePathConflict(tasks, {
      id: "save-as",
      targetPath: "c:/downloads/out.bin",
      targetConnectionId: "local",
    })?.id,
    "live",
  );
  assert.equal(
    findActivePathConflict(tasks, {
      id: "other",
      targetPath: "C:\\Downloads\\other.bin",
      targetConnectionId: "local",
    }),
    undefined,
  );
});

test("pathConflictMessage distinguishes paused vs running", () => {
  assert.match(pathConflictMessage({ fileName: "x", status: "paused" }), /paused/i);
  assert.match(pathConflictMessage({ fileName: "x", status: "transferring" }), /in progress/i);
});
