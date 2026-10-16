import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_TERMINAL_HOST_ID,
  createLocalTerminalSession,
} from "./sessionFactories.ts";

test("createLocalTerminalSession uses a stable hostId across sessions", () => {
  const a = createLocalTerminalSession("session-a");
  const b = createLocalTerminalSession("session-b");

  assert.equal(a.hostId, LOCAL_TERMINAL_HOST_ID);
  assert.equal(b.hostId, LOCAL_TERMINAL_HOST_ID);
  assert.notEqual(a.id, b.id);
  assert.equal(a.protocol, "local");
});
