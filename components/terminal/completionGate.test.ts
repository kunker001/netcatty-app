import test from "node:test";
import assert from "node:assert/strict";

import { shouldQueryCompletions } from "./autocomplete/useTerminalAutocomplete.ts";

test("queries completions when the popup menu is enabled", () => {
  assert.equal(
    shouldQueryCompletions({ showPopupMenu: true, showGhostText: false }),
    true,
  );
});

test("queries completions when ghost text is enabled", () => {
  assert.equal(
    shouldQueryCompletions({ showPopupMenu: false, showGhostText: true }),
    true,
  );
});

test("skips completion work when both popup and ghost text are off", () => {
  assert.equal(
    shouldQueryCompletions({ showPopupMenu: false, showGhostText: false }),
    false,
  );
});
