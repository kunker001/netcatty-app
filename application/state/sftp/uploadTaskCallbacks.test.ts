import assert from "node:assert/strict";
import test from "node:test";

import type { TransferTask } from "../../../domain/models";
import { createUploadTaskCallbacks } from "./uploadTaskCallbacks";

test("upload task callbacks write through the transfer store without page callbacks", () => {
  const upserts: TransferTask[][] = [];
  const patches: Array<{ taskId: string; updates: Partial<TransferTask> }> = [];
  const dismissed: string[] = [];
  const store = {
    upsertTasks: (tasks: readonly TransferTask[]) => upserts.push([...tasks]),
    patchTask: (taskId: string, updates: Partial<TransferTask>) => patches.push({ taskId, updates }),
    dismiss: (taskId: string) => dismissed.push(taskId),
  };
  const callbacks = createUploadTaskCallbacks({
    ownerId: "owner-1",
    connectionId: "connection-1",
    targetPath: "/remote",
    targetHostId: "host-1",
    store,
  });

  callbacks.onTaskCreated?.({
    id: "upload-1",
    fileName: "file.bin",
    displayName: "file.bin",
    sourcePath: "/local/file.bin",
    totalBytes: 100,
    isDirectory: false,
  });
  callbacks.onTaskProgress?.("upload-1", {
    transferred: 40,
    total: 100,
    speed: 20,
    percent: 40,
    checkpointBytes: 32,
    phase: "transferring",
  });
  callbacks.onTaskCompleted?.("upload-1", 100);

  assert.equal(upserts.length, 1);
  assert.equal(upserts[0][0].ownerId, "owner-1");
  assert.equal(upserts[0][0].id, "upload-1");
  assert.deepEqual(patches[0], {
    taskId: "upload-1",
    updates: {
      transferredBytes: 40,
      totalBytes: 100,
      checkpointBytes: 32,
      speed: 20,
      phase: "transferring",
      resumable: undefined,
      pauseUnavailableReason: undefined,
    },
  });
  assert.equal(patches[1].taskId, "upload-1");
  assert.equal(patches[1].updates.status, "completed");
  assert.equal(patches[1].updates.transferredBytes, 100);
  assert.deepEqual(dismissed, []);
});

test("progress promotes pending scanning folder rows into transferring", () => {
  const patches: Array<{ taskId: string; updates: Partial<TransferTask> }> = [];
  const liveTask: TransferTask = {
    id: "folder-1",
    fileName: "docs",
    sourcePath: "local",
    targetPath: "/remote/docs",
    sourceConnectionId: "external",
    targetConnectionId: "connection-1",
    direction: "upload",
    status: "pending",
    totalBytes: 0,
    transferredBytes: 0,
    speed: 0,
    startTime: 1,
    isDirectory: true,
    progressMode: "files",
    phase: "scanning",
  };
  const store = {
    upsertTasks: () => {},
    patchTask: (taskId: string, updates: Partial<TransferTask>) => patches.push({ taskId, updates }),
    dismiss: () => {},
    getTask: (taskId: string) => (taskId === "folder-1" ? liveTask : undefined),
  };
  const callbacks = createUploadTaskCallbacks({
    ownerId: "owner-1",
    connectionId: "connection-1",
    targetPath: "/remote",
    store,
  });

  callbacks.onTaskProgress?.("folder-1", {
    transferred: 12,
    total: 400,
    speed: 0,
    percent: 3,
    phase: "transferring",
  });

  assert.equal(patches[0].taskId, "folder-1");
  assert.equal(patches[0].updates.status, "transferring");
  assert.equal(patches[0].updates.transferredBytes, 12);
  assert.equal(patches[0].updates.totalBytes, 400);
  assert.equal(patches[0].updates.phase, "transferring");
});

test("scanning callbacks expose live file counts in files progress mode", () => {
  const upserts: TransferTask[][] = [];
  const patches: Array<{ taskId: string; updates: Partial<TransferTask> }> = [];
  const store = {
    upsertTasks: (tasks: readonly TransferTask[]) => upserts.push([...tasks]),
    patchTask: (taskId: string, updates: Partial<TransferTask>) => patches.push({ taskId, updates }),
    dismiss: () => {},
  };
  const callbacks = createUploadTaskCallbacks({
    ownerId: "owner-1",
    connectionId: "connection-1",
    targetPath: "/remote",
    store,
  });

  callbacks.onScanningStart?.("scan-1", { label: "docs" });
  callbacks.onScanningProgress?.("scan-1", {
    fileCount: 1284,
    directoryCount: 40,
    entryCount: 1324,
    label: "docs",
  });

  assert.equal(upserts[0][0].fileName, "docs");
  assert.equal(upserts[0][0].phase, "scanning");
  assert.equal(upserts[0][0].progressMode, "files");
  assert.equal(upserts[0][0].status, "pending");
  assert.deepEqual(patches[0], {
    taskId: "scan-1",
    updates: {
      // Found files live in totalBytes; completed stays 0 during scan.
      transferredBytes: 0,
      totalBytes: 1284,
      progressMode: "files",
      phase: "scanning",
      fileName: "docs",
    },
  });

  // Display contract: 0 done · N found (not N done · N found).
  const discovered = Math.max(patches[0].updates.totalBytes ?? 0, patches[0].updates.transferredBytes ?? 0);
  const completed = patches[0].updates.transferredBytes ?? 0;
  assert.equal(completed, 0);
  assert.equal(discovered, 1284);
});
