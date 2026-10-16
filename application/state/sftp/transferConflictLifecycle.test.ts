import assert from "node:assert/strict";
import test from "node:test";

import type { FileConflictAction, TransferTask } from "../../../domain/models";
import {
  captureDeferredTransferAttempt,
  createDeferredTransferAttemptQueue,
  isDeferredTransferAttemptCurrent,
  pruneTransferConflictDefaults,
  type TransferConflictDefaults,
} from "./transferConflictLifecycle";

const task = (id: string, batchId: string, status: TransferTask["status"]): TransferTask => ({
  id,
  batchId,
  fileName: id,
  sourcePath: `/source/${id}`,
  targetPath: `/target/${id}`,
  sourceConnectionId: "source",
  targetConnectionId: "target",
  direction: "remote-to-remote",
  status,
  totalBytes: 1,
  transferredBytes: 0,
  speed: 0,
  startTime: 1,
  isDirectory: false,
});

test("terminal batches release their apply-to-all conflict defaults", () => {
  const defaults: TransferConflictDefaults = new Map<string, Map<string, FileConflictAction>>([
    ["live", new Map([["file:file", "replace"]])],
    ["finished", new Map([["file:file", "skip"]])],
  ]);

  pruneTransferConflictDefaults(defaults, [
    task("live-task", "live", "transferring"),
    task("finished-task", "finished", "completed"),
  ]);

  assert.deepEqual([...defaults.keys()], ["live"]);
});

test("deferred conflict attempts are cancelled on owner unmount", async () => {
  const timers = new Map<number, () => void>();
  let nextTimerId = 0;
  let calls = 0;
  const queue = createDeferredTransferAttemptQueue({
    setTimeoutFn(callback) {
      const id = ++nextTimerId;
      timers.set(id, callback);
      return id;
    },
    clearTimeoutFn(id) {
      timers.delete(id as number);
    },
  });

  queue.schedule("task-a", 100, () => true, async () => { calls += 1; });
  queue.schedule("task-b", 100, () => true, async () => { calls += 1; });
  assert.equal(queue.size, 2);

  queue.dispose();
  for (const callback of timers.values()) callback();
  await Promise.resolve();

  assert.equal(calls, 0);
  assert.equal(queue.size, 0);
  assert.equal(timers.size, 0);
});

test("deferred conflict attempts revalidate the current task before starting", async () => {
  const timers: Array<() => void> = [];
  let stillCurrent = true;
  let calls = 0;
  const queue = createDeferredTransferAttemptQueue({
    setTimeoutFn(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearTimeoutFn() {},
  });

  queue.schedule("task-a", 100, () => stillCurrent, async () => { calls += 1; });
  stillCurrent = false;
  timers[0]?.();
  await Promise.resolve();

  assert.equal(calls, 0);
  assert.equal(queue.size, 0);
});

test("deferred conflict identity rejects owner, endpoint, and task lifecycle changes", () => {
  const current = { ...task("task-a", "batch-a", "pending"), ownerId: "owner-a" };
  const connectionKeys = new Map([
    ["source", "source-generation-1"],
    ["target", "target-generation-1"],
  ]);
  const identity = captureDeferredTransferAttempt(current, "owner-a", connectionKeys);

  assert.equal(isDeferredTransferAttemptCurrent(current, identity, connectionKeys), true);
  assert.equal(isDeferredTransferAttemptCurrent(
    { ...current, ownerId: "owner-b" },
    identity,
    connectionKeys,
  ), false);
  assert.equal(isDeferredTransferAttemptCurrent(
    current,
    identity,
    new Map(connectionKeys).set("target", "target-generation-2"),
  ), false);
  assert.equal(isDeferredTransferAttemptCurrent(
    { ...current, status: "cancelled" },
    identity,
    connectionKeys,
  ), false);
});
