import test from "node:test";
import assert from "node:assert/strict";

import {
  clearTerminalBootEpoch,
  isTerminalBootEpochCurrent,
  setTerminalBootEpoch,
} from "./terminalBootEpoch";

test("mismatched boot epochs are treated as stale", () => {
  setTerminalBootEpoch("session-1", 3);
  assert.equal(isTerminalBootEpochCurrent("session-1", 1), false);
  assert.equal(isTerminalBootEpochCurrent("session-1", 3), true);
  assert.equal(isTerminalBootEpochCurrent("session-1", undefined), true);
  clearTerminalBootEpoch("session-1");
  assert.equal(isTerminalBootEpochCurrent("session-1", 3), false);
  assert.equal(isTerminalBootEpochCurrent("session-1", undefined), true);
});
