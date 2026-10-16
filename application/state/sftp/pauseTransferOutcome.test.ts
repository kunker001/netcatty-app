import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createGlobalSftpTransferScheduler } from "./globalTransferScheduler.ts";
import {
  allPauseResultsBenignOrSuccess,
  allPauseResultsDeadTransfer,
  isBenignPauseMiss,
  isDeadTransferPauseMiss,
  isHardPauseFailure,
  planPartialPauseRollback,
  resolveDirectoryPauseParentOutcome,
  shouldLatchPauseWaiters,
} from "./pauseTransferOutcome.ts";

test("benign pause misses match store regex (no longer active / not found / session)", () => {
  assert.equal(isBenignPauseMiss("Transfer is no longer active"), true);
  assert.equal(isBenignPauseMiss("session not found"), true);
  assert.equal(isBenignPauseMiss("SFTP session closed"), true);
  assert.equal(isBenignPauseMiss("This transfer cannot be paused safely"), false);
  assert.equal(isBenignPauseMiss("Pause unavailable"), false);
});

test("dead transfer pause misses are a strict subset of benign misses", () => {
  assert.equal(isDeadTransferPauseMiss("Transfer is no longer active"), true);
  assert.equal(isDeadTransferPauseMiss("session not found"), true);
  assert.equal(isDeadTransferPauseMiss("SFTP session closed"), false);
  assert.equal(allPauseResultsDeadTransfer([
    { success: false, reason: "Transfer is no longer active" },
  ]), true);
  assert.equal(allPauseResultsDeadTransfer([
    { success: true },
    { success: false, reason: "Transfer is no longer active" },
  ]), false);
  assert.equal(allPauseResultsDeadTransfer([
    { success: false, reason: "cannot be paused safely" },
  ]), false);
});

test("allPauseResultsBenignOrSuccess rejects mixed hard failures", () => {
  assert.equal(allPauseResultsBenignOrSuccess([
    { success: true },
    { success: false, reason: "no longer active" },
  ]), true);
  assert.equal(allPauseResultsBenignOrSuccess([
    { success: true },
    { success: false, reason: "cannot be paused safely" },
  ]), false);
  assert.equal(allPauseResultsBenignOrSuccess([]), true);
});

test("directory parent stays paused even when some children hard-fail pause", () => {
  // Latch-first: partial child failures must not unpause the folder parent.
  assert.deepEqual(
    resolveDirectoryPauseParentOutcome([
      { success: true },
      { success: false, reason: "cannot be paused safely" },
    ]),
    { kind: "paused", reason: "cannot be paused safely" },
  );
  assert.deepEqual(
    resolveDirectoryPauseParentOutcome([
      { success: false, reason: "This transfer cannot be paused yet" },
    ]),
    { kind: "paused", reason: "This transfer cannot be paused yet" },
  );
  assert.deepEqual(
    resolveDirectoryPauseParentOutcome([
      { success: false, reason: "Could not verify the saved transfer checkpoint" },
    ]),
    { kind: "paused", reason: "Could not verify the saved transfer checkpoint" },
  );
  assert.deepEqual(
    resolveDirectoryPauseParentOutcome([
      { success: false, reason: "no longer active" },
      { success: true },
    ]),
    { kind: "paused" },
  );
});

test("pause waiters latch only on successful pause", () => {
  assert.equal(shouldLatchPauseWaiters({ pauseSucceeded: true }), true);
  assert.equal(shouldLatchPauseWaiters({ pauseSucceeded: false }), false);
});

test("isHardPauseFailure treats missing result as hard", () => {
  assert.equal(isHardPauseFailure(undefined), true);
  assert.equal(isHardPauseFailure({ success: false, reason: "no longer active" }), false);
  assert.equal(isHardPauseFailure({ success: true }), false);
});

test("planPartialPauseRollback unparks scheduler jobs and successful bridge pauses", () => {
  // active: parent + 3 children. scheduler.pause succeeded for child-a (not in backendIds).
  // bridge: child-b success, child-c hard fail, parent not in directory activeIds.
  const plan = planPartialPauseRollback({
    activeIds: ["child-a", "child-b", "child-c"],
    backendIds: ["child-b", "child-c"],
    bridgeResults: [
      { success: true },
      { success: false, reason: "cannot be paused safely" },
    ],
  });
  assert.deepEqual(plan.schedulerIdsToResume, ["child-a"]);
  assert.deepEqual(plan.bridgeIdsToResume, ["child-b"]);
});

test("planPartialPauseRollback for single-file includes parent when only children hit bridge", () => {
  // Single-file: activeIds = [parent, child]; scheduler parked parent, bridge paused child then hard-fails parent.
  const plan = planPartialPauseRollback({
    activeIds: ["parent", "child"],
    backendIds: ["parent", "child"],
    bridgeResults: [
      { success: false, reason: "cannot be paused safely" },
      { success: true },
    ],
  });
  assert.deepEqual(plan.schedulerIdsToResume, []);
  assert.deepEqual(plan.bridgeIdsToResume, ["child"]);
});

test("mixed hard-fail rollback resumes real scheduler-parked jobs so work continues", async () => {
  const scheduler = createGlobalSftpTransferScheduler();
  let childAFinished = false;
  const hold = { release: null as null | (() => void) };
  const block = new Promise<void>((resolve) => {
    hold.release = resolve;
  });

  // Concurrency 1: hold the only slot so child-a stays queued and can be pause()'d.
  const holder = scheduler.run("owner", "holder", ["host-1"], () => 1, async () => {
    await block;
  });
  const childA = scheduler.run("owner", "child-a", ["host-1"], () => 1, async () => {
    childAFinished = true;
  });

  // Allow holder to become active and child-a to queue.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(scheduler.pause("child-a"), true, "child-a must be queued so pause parks it");

  // Mimic panel path: activeIds include scheduler-parked + bridge targets; bridge hard-fails one.
  const plan = planPartialPauseRollback({
    activeIds: ["child-a", "child-b"],
    backendIds: ["child-b"],
    bridgeResults: [{ success: false, reason: "cannot be paused safely" }],
  });
  assert.deepEqual(plan.schedulerIdsToResume, ["child-a"]);

  for (const id of plan.schedulerIdsToResume) {
    assert.equal(scheduler.resume(id), true);
  }
  hold.release?.();
  await holder;
  await childA;
  assert.equal(childAFinished, true, "parked child-a must run after rollback resume");
});

test("panel pause delegates to TransferRuntime; soft-control + rollback live in process-global control", () => {
  // Dual soft-control path was removed: panel only calls transferRuntime.
  const panelSource = readFileSync(new URL("./useSftpTransfers.ts", import.meta.url), "utf8");
  assert.match(panelSource, /transferRuntime\.pause/);
  assert.match(panelSource, /transferRuntime\.resume/);
  assert.doesNotMatch(panelSource, /rollbackPartialPause/);
  assert.doesNotMatch(panelSource, /resolveDirectoryPauseParentOutcome/);

  // planPartialPauseRollback remains on the single soft-control plane.
  const controlSource = readFileSync(new URL("./globalSftpTransferControl.ts", import.meta.url), "utf8");
  assert.match(controlSource, /planPartialPauseRollback/);
  assert.match(controlSource, /bridgeIdsToResume/);
  assert.match(controlSource, /softPauseTransfer/);
  assert.match(controlSource, /softResumeTransfer/);
});
