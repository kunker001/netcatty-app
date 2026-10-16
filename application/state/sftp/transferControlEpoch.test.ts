import assert from "node:assert/strict";
import test from "node:test";

import {
  bumpTransferControlEpoch,
  getTransferControlEpoch,
  isTransferControlEpochCurrent,
  resetTransferControlEpochsForTests,
  settleTransferControlEpochTree,
} from "./transferControlEpoch";

test("control epoch starts at 0 and bumps monotonically per id", () => {
  resetTransferControlEpochsForTests();
  assert.equal(getTransferControlEpoch("a"), 0);
  assert.equal(bumpTransferControlEpoch("a"), 1);
  assert.equal(bumpTransferControlEpoch("a"), 2);
  assert.equal(getTransferControlEpoch("a"), 2);
  assert.equal(getTransferControlEpoch("b"), 0);
  assert.equal(isTransferControlEpochCurrent("a", 2), true);
  assert.equal(isTransferControlEpochCurrent("a", 1), false);
});

test("resume-style bump invalidates a captured pause epoch", () => {
  resetTransferControlEpochsForTests();
  const pauseEpoch = bumpTransferControlEpoch("folder");
  assert.equal(isTransferControlEpochCurrent("folder", pauseEpoch), true);
  // User hits resume immediately.
  bumpTransferControlEpoch("folder");
  assert.equal(isTransferControlEpochCurrent("folder", pauseEpoch), false);
});

test("settled single-file control epochs do not accumulate across a large batch", () => {
  resetTransferControlEpochsForTests();
  const taskIds = Array.from({ length: 4_000 }, (_, index) => `single-${index}`);

  for (const taskId of taskIds) {
    const epoch = bumpTransferControlEpoch(taskId);
    assert.equal(isTransferControlEpochCurrent(taskId, epoch), true);
    settleTransferControlEpochTree(taskId);
    assert.equal(getTransferControlEpoch(taskId), 0);
    assert.equal(isTransferControlEpochCurrent(taskId, epoch), false);
  }
});

test("reusing a settled task id cannot make an old pause epoch current again", () => {
  resetTransferControlEpochsForTests();
  const oldPauseEpoch = bumpTransferControlEpoch("same-id");
  settleTransferControlEpochTree("same-id");

  const retryPauseEpoch = bumpTransferControlEpoch("same-id");

  assert.ok(retryPauseEpoch > oldPauseEpoch);
  assert.equal(isTransferControlEpochCurrent("same-id", oldPauseEpoch), false);
  assert.equal(isTransferControlEpochCurrent("same-id", retryPauseEpoch), true);
});

test("settling a directory tree releases parent and child control epochs together", () => {
  resetTransferControlEpochsForTests();
  const childIds = Array.from({ length: 4_000 }, (_, index) => `directory-child-${index}`);
  const rootEpoch = bumpTransferControlEpoch("directory-root");
  const childEpochs = childIds.map((childId) => bumpTransferControlEpoch(childId));

  settleTransferControlEpochTree("directory-root", childIds);

  assert.equal(isTransferControlEpochCurrent("directory-root", rootEpoch), false);
  for (let index = 0; index < childIds.length; index += 1) {
    assert.equal(getTransferControlEpoch(childIds[index]), 0);
    assert.equal(isTransferControlEpochCurrent(childIds[index], childEpochs[index]), false);
  }
});
