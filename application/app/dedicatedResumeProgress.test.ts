import assert from "node:assert/strict";
import test from "node:test";
import type { TransferTask } from "../../domain/models";
import {
  canApplyDedicatedResumeProgress,
  createDedicatedResumeChildUpdateBatcher,
  createDedicatedResumeProgressBatcher,
  DEDICATED_RESUME_CHILD_UPDATE_BATCH_SIZE,
} from "./dedicatedResumeProgress";

test("deferred dedicated-resume progress cannot reopen a settled row", () => {
  for (const status of [
    "pausing",
    "paused",
    "completed",
    "failed",
    "cancelled",
    "attention",
    "interrupted",
  ] as const) {
    assert.equal(canApplyDedicatedResumeProgress(status), false, status);
  }
  for (const status of ["pending", "queued", "transferring"] as const) {
    assert.equal(canApplyDedicatedResumeProgress(status), true, status);
  }
});

test("late animation-frame progress cannot revive any settled resume state", () => {
  const settledStatuses = [
    "pausing",
    "paused",
    "completed",
    "failed",
    "cancelled",
    "attention",
    "interrupted",
  ] as const;

  for (const settledStatus of settledStatuses) {
    let status: TransferTask["status"] = "transferring";
    let scheduled: FrameRequestCallback | undefined;
    const applied: number[] = [];
    const batcher = createDedicatedResumeProgressBatcher<number>({
      requestFrame: (callback) => {
        scheduled = callback;
        return 41;
      },
      cancelFrame: () => undefined,
      canApply: () => canApplyDedicatedResumeProgress(status),
      apply: (progress) => applied.push(progress),
    });

    batcher.push(7);
    status = settledStatus;
    scheduled?.(0);
    assert.deepEqual(applied, [], settledStatus);
  }
});

test("finishing a resume flushes once and rejects raced or future progress", () => {
  let status: TransferTask["status"] = "transferring";
  let scheduled: FrameRequestCallback | undefined;
  const cancelledHandles: number[] = [];
  const applied: number[] = [];
  const batcher = createDedicatedResumeProgressBatcher<number>({
    requestFrame: (callback) => {
      scheduled = callback;
      return 73;
    },
    cancelFrame: (handle) => cancelledHandles.push(handle),
    canApply: () => canApplyDedicatedResumeProgress(status),
    apply: (progress) => applied.push(progress),
  });

  batcher.push(11);
  batcher.push(12);
  batcher.finish();
  status = "completed";
  scheduled?.(0); // Simulate a frame already dequeued when it was cancelled.
  batcher.push(13);
  batcher.finish();

  assert.deepEqual(applied, [12]);
  assert.deepEqual(cancelledHandles, [73]);
});

test("50,000 retained child updates use a hard-bounded number of store scans", () => {
  const retained = new Set(Array.from({ length: 50_000 }, (_, index) => `child-${index}`));
  const batches: TransferTask[][] = [];
  const batcher = createDedicatedResumeChildUpdateBatcher({
    getTaskCount: () => 50_001,
    hasTask: (taskId) => retained.has(taskId),
    upsertTasks: (tasks) => batches.push([...tasks]),
  });

  for (let index = 0; index < 50_000; index += 1) {
    const child = {
      id: `child-${index}`,
      status: "transferring",
      parentTaskId: "parent",
    } as TransferTask;
    batcher.push(child);
    batcher.push({ ...child, status: "completed" });
  }
  batcher.flush();

  assert.ok(
    batches.length <= Math.ceil(50_000 / DEDICATED_RESUME_CHILD_UPDATE_BATCH_SIZE),
    `expected bounded store scans, got ${batches.length}`,
  );
  const finalById = new Map<string, TransferTask>();
  for (const task of batches.flat()) finalById.set(task.id, task);
  assert.equal(finalById.size, 50_000);
  assert.ok([...finalById.values()].every((task) => task.status === "completed"));
  assert.ok(
    batches.flat().length <= 50_000 + batches.length,
    "a batch-boundary transition may repeat at most one child per store scan",
  );
});
