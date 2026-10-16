import assert from "node:assert/strict";
import test from "node:test";

import {
  isTransferOrRootPauseLatched,
  isTransferPauseLatched,
  latchTransferPause,
  latchTransferPauseTree,
  listTransferPauseLatchesForTests,
  releaseTransferPause,
  releaseTransferPauseTree,
  resetTransferPauseLatchesForTests,
  waitUntilTransferPauseReleased,
  waitWhileTransferOrRootPaused,
} from "./transferPauseLatch";

test("latch and release are process-global and wake waiters", async () => {
  resetTransferPauseLatchesForTests();
  latchTransferPause("parent");
  assert.equal(isTransferPauseLatched("parent"), true);

  let released = false;
  const waiter = waitUntilTransferPauseReleased("parent").then(() => {
    released = true;
  });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(released, false);

  releaseTransferPause("parent");
  await waiter;
  assert.equal(released, true);
  assert.equal(isTransferPauseLatched("parent"), false);
});

test("root latch blocks child wait and tree release clears both", async () => {
  resetTransferPauseLatchesForTests();
  latchTransferPauseTree("dir", ["child-a", "child-b"]);
  assert.equal(isTransferOrRootPauseLatched("dir", "child-a"), true);
  assert.deepEqual(listTransferPauseLatchesForTests(), ["child-a", "child-b", "dir"]);

  let done = false;
  const waiter = waitWhileTransferOrRootPaused("dir", "child-a").then(() => {
    done = true;
  });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(done, false);

  releaseTransferPauseTree("dir", ["child-a", "child-b"]);
  await waiter;
  assert.equal(done, true);
  assert.deepEqual(listTransferPauseLatchesForTests(), []);
});

test("idempotent release does not throw", () => {
  resetTransferPauseLatchesForTests();
  releaseTransferPause("missing");
  latchTransferPause("x");
  releaseTransferPause("x");
  releaseTransferPause("x");
  assert.equal(isTransferPauseLatched("x"), false);
});

test("releasing only the parent leaves child latches stuck (documents the bug we fixed)", () => {
  resetTransferPauseLatchesForTests();
  latchTransferPauseTree("dir", ["c1", "c2"]);
  // Wrong: only parent (the old resume path).
  releaseTransferPause("dir");
  assert.equal(isTransferPauseLatched("dir"), false);
  assert.equal(isTransferOrRootPauseLatched("dir", "c1"), true, "child latch still blocks the walk");
  // Right: full tree.
  releaseTransferPauseTree("dir", ["c1", "c2"]);
  assert.equal(isTransferOrRootPauseLatched("dir", "c1"), false);
});
