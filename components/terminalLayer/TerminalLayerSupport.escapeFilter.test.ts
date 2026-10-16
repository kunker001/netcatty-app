import assert from "node:assert/strict";
import test from "node:test";

import { MAX_INCOMPLETE_TERMINAL_CONTROL_SEQUENCE_CHARS } from "../terminal/runtime/terminalControlSequenceLimits";
import { ChunkedEscapeFilter } from "./activityEscapeFilter";

test("activity escape filter bounds unterminated OSC data and recovers on the next chunk", () => {
  const filter = new ChunkedEscapeFilter();
  const chunk = "x".repeat(1024);
  let emitted = "";

  emitted += filter.feed("\x1b]0;");
  for (let size = 0; size <= MAX_INCOMPLETE_TERMINAL_CONTROL_SEQUENCE_CHARS; size += chunk.length) {
    emitted += filter.feed(chunk);
  }

  assert.ok(emitted.length >= MAX_INCOMPLETE_TERMINAL_CONTROL_SEQUENCE_CHARS);
  assert.equal(filter.feed("normal output"), "normal output");
});
