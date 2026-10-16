import assert from "node:assert/strict";
import test from "node:test";

import type { TransferTask } from "../../../domain/models";
import {
  isExternalDragDropFileUpload,
  retryExternalDragDropFileUpload,
} from "./externalDragDropRetry";

const baseTask = (overrides: Partial<TransferTask> = {}): TransferTask => ({
  id: "child-1",
  fileName: "a.txt",
  sourcePath: "/tmp/docs/a.txt",
  targetPath: "/remote/docs/a.txt",
  sourceConnectionId: "external",
  targetConnectionId: "conn-1",
  targetHostId: "host-1",
  direction: "upload",
  status: "failed",
  totalBytes: 12,
  transferredBytes: 0,
  speed: 0,
  startTime: 1,
  isDirectory: false,
  origin: "drag-drop",
  parentTaskId: "folder-1",
  error: "Network error",
  ...overrides,
});

test("detects progressive drag-drop file children as retryable", () => {
  assert.equal(isExternalDragDropFileUpload(baseTask()), true);
  assert.equal(isExternalDragDropFileUpload(baseTask({ isDirectory: true })), false);
  assert.equal(isExternalDragDropFileUpload(baseTask({ origin: "manual" })), false);
  assert.equal(isExternalDragDropFileUpload(baseTask({ sourceConnectionId: "local" })), false);
  assert.equal(isExternalDragDropFileUpload(baseTask({ status: "completed" })), false);
  assert.equal(isExternalDragDropFileUpload(baseTask({ retryable: false })), false);
});

test("retry reuses the same transfer id and starts a stream upload", async () => {
  const patches: Array<{ id: string; updates: Partial<TransferTask> }> = [];
  const streams: Array<Record<string, unknown>> = [];

  // No pool acquire → falls back to browse sftp id.
  const result = await retryExternalDragDropFileUpload(baseTask(), {
    getBrowseSftpId: () => "sftp-live",
    startStreamTransfer: async (options) => {
      streams.push(options as unknown as Record<string, unknown>);
      return { transferId: options.transferId };
    },
    onPatch: (taskId, updates) => patches.push({ id: taskId, updates }),
  });

  assert.equal(result.success, true);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].transferId, "child-1");
  assert.equal(streams[0].sourcePath, "/tmp/docs/a.txt");
  assert.equal(streams[0].targetPath, "/remote/docs/a.txt");
  assert.equal(streams[0].targetSftpId, "sftp-live");
  assert.equal(patches[0].updates.status, "transferring");
  assert.equal(patches.at(-1)?.updates.status, "completed");
});

test("retry prefers a dedicated pool session over the browse sftp id", async () => {
  let released = false;
  let acquired = false;
  const result = await retryExternalDragDropFileUpload(baseTask(), {
    getBrowseSftpId: () => "sftp-live",
    acquireTransferSession: async () => {
      acquired = true;
      return {
        sftpId: "sftp-pool",
        poolKey: "host-1",
        release: () => { released = true; },
        discard: () => {},
      };
    },
    startStreamTransfer: async (options) => {
      assert.equal(options.targetSftpId, "sftp-pool");
      return {};
    },
    onPatch: () => {},
  });

  assert.equal(result.success, true);
  assert.equal(acquired, true);
  assert.equal(released, true);
});

test("retry falls back to browse when pool acquire is unavailable", async () => {
  const result = await retryExternalDragDropFileUpload(baseTask(), {
    getBrowseSftpId: () => "sftp-live",
    startStreamTransfer: async (options) => {
      assert.equal(options.targetSftpId, "sftp-live");
      return {};
    },
    onPatch: () => {},
  });
  assert.equal(result.success, true);
});

test("retry rolls parent to completed when all siblings succeed", async () => {
  const patches: Array<{ id: string; updates: Partial<TransferTask> }> = [];
  const result = await retryExternalDragDropFileUpload(baseTask(), {
    getBrowseSftpId: () => "sftp-live",
    startStreamTransfer: async () => ({}),
    getTask: (id) => (
      id === "folder-1"
        ? baseTask({
          id: "folder-1",
          isDirectory: true,
          status: "failed",
          sourcePath: "/tmp/docs",
          targetPath: "/remote/docs",
          error: "1 of 2 files failed",
          totalBytes: 2,
          transferredBytes: 1,
          parentTaskId: undefined,
        })
        : undefined
    ),
    getChildTasks: () => [
      baseTask({ id: "child-1", status: "transferring" }),
      baseTask({ id: "child-2", status: "completed", sourcePath: "/tmp/docs/b.txt" }),
    ],
    onPatch: (taskId, updates) => patches.push({ id: taskId, updates }),
  });
  assert.equal(result.success, true);
  const parentPatch = patches.find((p) => p.id === "folder-1");
  assert.ok(parentPatch);
  assert.equal(parentPatch?.updates.status, "completed");
});

test("retry does not rollup a still-transferring progressive parent", async () => {
  const patches: Array<{ id: string; updates: Partial<TransferTask> }> = [];
  await retryExternalDragDropFileUpload(baseTask(), {
    getBrowseSftpId: () => "sftp-live",
    startStreamTransfer: async () => ({}),
    getTask: (id) => (
      id === "folder-1"
        ? baseTask({
          id: "folder-1",
          isDirectory: true,
          status: "transferring",
          sourcePath: "/tmp/docs",
          parentTaskId: undefined,
        })
        : undefined
    ),
    getChildTasks: () => [
      baseTask({ id: "child-1", status: "transferring" }),
      baseTask({ id: "child-2", status: "completed", sourcePath: "/tmp/docs/b.txt" }),
    ],
    onPatch: (taskId, updates) => patches.push({ id: taskId, updates }),
  });
  assert.equal(patches.some((p) => p.id === "folder-1"), false);
});

test("retry fails clearly when no sftp session can be opened", async () => {
  const patches: Array<Partial<TransferTask>> = [];
  const result = await retryExternalDragDropFileUpload(baseTask(), {
    getBrowseSftpId: () => undefined,
    startStreamTransfer: async () => {
      throw new Error("should not start");
    },
    onPatch: (_id, updates) => patches.push(updates),
  });

  assert.equal(result.success, false);
  assert.match(result.error || "", /No SFTP session/);
  assert.equal(patches.at(-1)?.status, "failed");
});

test("stream error keeps the row failed with the backend message", async () => {
  const patches: Array<Partial<TransferTask>> = [];
  const result = await retryExternalDragDropFileUpload(baseTask(), {
    getBrowseSftpId: () => "sftp-live",
    startStreamTransfer: async () => ({ error: "Permission denied" }),
    onPatch: (_id, updates) => patches.push(updates),
  });

  assert.equal(result.success, false);
  assert.equal(result.error, "Permission denied");
  assert.equal(patches.at(-1)?.status, "failed");
  assert.equal(patches.at(-1)?.error, "Permission denied");
});
