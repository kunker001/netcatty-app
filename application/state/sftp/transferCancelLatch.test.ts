import assert from "node:assert/strict";
import test from "node:test";

import {
  clearTransferCancelledTree,
  isTransferCancelledFlag,
  isTransferOrRootCancelled,
  markTransferCancelled,
  markTransferCancelledTree,
  resetTransferCancelLatchesForTests,
  settleTransferCancelTree,
} from "./transferCancelLatch";

test("cancel flags are process-global for root and children", () => {
  resetTransferCancelLatchesForTests();
  markTransferCancelledTree("parent", ["c1", "c2"]);
  assert.equal(isTransferCancelledFlag("parent"), true);
  assert.equal(isTransferOrRootCancelled("parent", "c1"), true);
  assert.equal(isTransferCancelledFlag("other"), false);
  clearTransferCancelledTree("parent", ["c1", "c2"]);
  assert.equal(isTransferCancelledFlag("parent"), false);
  assert.equal(isTransferCancelledFlag("c1"), false);
});

test("settled single-file cancellations do not accumulate across a large batch", () => {
  resetTransferCancelLatchesForTests();
  const taskIds = Array.from({ length: 4_000 }, (_, index) => `single-${index}`);

  for (const taskId of taskIds) {
    markTransferCancelled(taskId);
    assert.equal(isTransferCancelledFlag(taskId), true);
    settleTransferCancelTree(taskId);
  }

  for (const taskId of taskIds) {
    assert.equal(isTransferCancelledFlag(taskId), false);
  }
});

test("settling a directory root releases every child recorded by tree cancellation", () => {
  resetTransferCancelLatchesForTests();
  const childIds = Array.from({ length: 4_000 }, (_, index) => `directory-child-${index}`);
  markTransferCancelledTree("directory-root", childIds);

  settleTransferCancelTree("directory-root");

  assert.equal(isTransferCancelledFlag("directory-root"), false);
  for (const childId of childIds) {
    assert.equal(isTransferCancelledFlag(childId), false);
  }
});

test("same-id resume clears the old tree without masking a later cancellation", () => {
  resetTransferCancelLatchesForTests();
  markTransferCancelledTree("same-root", ["old-child"]);
  clearTransferCancelledTree("same-root");

  markTransferCancelledTree("same-root", ["new-child"]);

  assert.equal(isTransferCancelledFlag("old-child"), false);
  assert.equal(isTransferCancelledFlag("same-root"), true);
  assert.equal(isTransferCancelledFlag("new-child"), true);
  settleTransferCancelTree("same-root");
  assert.equal(isTransferCancelledFlag("same-root"), false);
  assert.equal(isTransferCancelledFlag("new-child"), false);
});
