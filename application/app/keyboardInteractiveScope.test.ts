import test from "node:test";
import assert from "node:assert/strict";

import {
  removeKeyboardInteractiveRequest,
  shouldQueueKeyboardInteractiveRequest,
} from "./useAppStartupEffects.ts";
import {
  clearTerminalBootEpoch,
  setTerminalBootEpoch,
} from "../../domain/terminalBootEpoch.ts";

const sessions = [{ id: "terminal-1" }, { id: "terminal-2" }];

test("terminal-scoped keyboard-interactive requests are limited to owned sessions", () => {
  assert.equal(
    shouldQueueKeyboardInteractiveRequest({ scope: "terminal", sessionId: "terminal-1" }, sessions),
    true,
  );
  assert.equal(
    shouldQueueKeyboardInteractiveRequest({ scope: "terminal", sessionId: "foreign-terminal" }, sessions),
    false,
  );
});

test("disconnected terminal sessions do not queue keyboard-interactive prompts", () => {
  assert.equal(
    shouldQueueKeyboardInteractiveRequest(
      { scope: "terminal", sessionId: "terminal-1" },
      [{ id: "terminal-1", status: "disconnected" }],
    ),
    false,
  );
  assert.equal(
    shouldQueueKeyboardInteractiveRequest(
      { scope: "terminal", sessionId: "terminal-1" },
      [{ id: "terminal-1", status: "connecting" }],
    ),
    true,
  );
});

test("superseded terminal boot epochs do not queue keyboard-interactive prompts", () => {
  setTerminalBootEpoch("terminal-1", 3);
  assert.equal(
    shouldQueueKeyboardInteractiveRequest(
      { scope: "terminal", sessionId: "terminal-1", bootEpoch: 1 },
      [{ id: "terminal-1", status: "connecting" }],
    ),
    false,
  );
  assert.equal(
    shouldQueueKeyboardInteractiveRequest(
      { scope: "terminal", sessionId: "terminal-1", bootEpoch: 3 },
      [{ id: "terminal-1", status: "connecting" }],
    ),
    true,
  );
  clearTerminalBootEpoch("terminal-1");
});

test("external keyboard-interactive requests are not filtered by terminal session ids", () => {
  assert.equal(
    shouldQueueKeyboardInteractiveRequest({ scope: "external", sessionId: "sftp-conn-1" }, sessions),
    true,
  );
  assert.equal(
    shouldQueueKeyboardInteractiveRequest({ scope: "external", sessionId: "tunnel-1" }, sessions),
    true,
  );
});

test("disabled peer windows still queue sender-targeted external keyboard-interactive requests", () => {
  assert.equal(
    shouldQueueKeyboardInteractiveRequest({ scope: "external", sessionId: "sftp-conn-1" }, sessions),
    true,
  );
});

test("disabled peer windows can still queue owned terminal keyboard-interactive requests", () => {
  assert.equal(
    shouldQueueKeyboardInteractiveRequest({ scope: "terminal", sessionId: "terminal-1" }, sessions),
    true,
  );
});

test("legacy unscoped keyboard-interactive requests remain visible", () => {
  assert.equal(
    shouldQueueKeyboardInteractiveRequest({ sessionId: "legacy-conn" }, sessions),
    true,
  );
});

test("cancelled keyboard-interactive requests are removed from the renderer queue", () => {
  const queue = [{ requestId: "keep" }, { requestId: "cancel" }];
  assert.deepEqual(removeKeyboardInteractiveRequest(queue, "cancel"), [{ requestId: "keep" }]);
});
