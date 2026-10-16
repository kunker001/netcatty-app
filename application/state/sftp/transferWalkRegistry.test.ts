import assert from "node:assert/strict";
import test from "node:test";

import {
  isTransferWalkInFlight,
  listTransferWalksForTests,
  registerTransferWalk,
  resetTransferWalkRegistryForTests,
  unregisterTransferWalk,
} from "./transferWalkRegistry";

test("walk registry is process-global and survives logical unmount", () => {
  resetTransferWalkRegistryForTests();
  registerTransferWalk("folder-1");
  assert.equal(isTransferWalkInFlight("folder-1"), true);
  assert.deepEqual(listTransferWalksForTests(), ["folder-1"]);
  // Simulate panel unmount: registry must still report the walk so soft-resume
  // does not start a second dedicated processTransfer.
  assert.equal(isTransferWalkInFlight("folder-1"), true);
  unregisterTransferWalk("folder-1");
  assert.equal(isTransferWalkInFlight("folder-1"), false);
});
