import test from "node:test";
import assert from "node:assert/strict";

import { terminalAltKeyOptions } from "./altKeyOptions";

// Issue #1078: with "Use Option as Meta key" enabled, macOS Option must send
// ESC-prefixed (Meta) sequences. xterm.js gates that on `macOptionIsMeta`. The
// flag was read from settings but only ever wired to the mouse alt-click
// behavior, so Option kept emitting layout characters (ƒ, ∫, …) instead of Meta.

test("Option-as-Meta enabled: Option emits Meta and alt-click cursor move is disabled", () => {
  assert.deepEqual(terminalAltKeyOptions(true), {
    macOptionIsMeta: true,
    altClickMovesCursor: false,
  });
});

test("Option-as-Meta disabled: xterm keeps default macOS Option behavior", () => {
  assert.deepEqual(terminalAltKeyOptions(false), {
    macOptionIsMeta: false,
    altClickMovesCursor: true,
  });
});
