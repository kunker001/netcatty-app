import assert from "node:assert/strict";
import test from "node:test";

import {
  isPlainCtrlCInterruptChord,
  isPlainMetaCCopyChord,
  shouldPassThroughCopyShortcut,
} from "./terminalCopyShortcut.ts";

const keyboardEvent = (
  key: string,
  code: string,
  modifiers: Partial<KeyboardEvent> = {},
): KeyboardEvent => ({
  key,
  code,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...modifiers,
}) as KeyboardEvent;

test("plain Ctrl+C copy with no selection passes through for SIGINT", () => {
  const event = keyboardEvent("c", "KeyC", { ctrlKey: true });

  assert.equal(isPlainCtrlCInterruptChord(event), true);
  assert.equal(shouldPassThroughCopyShortcut("copy", false, event), true);
});

test("plain Cmd+C copy with no selection passes through for Kitty Super+C", () => {
  const event = keyboardEvent("c", "KeyC", { metaKey: true });

  assert.equal(isPlainMetaCCopyChord(event), true);
  assert.equal(isPlainCtrlCInterruptChord(event), false);
  assert.equal(shouldPassThroughCopyShortcut("copy", false, event), true);
});

test("copy shortcut does not pass through when text is selected", () => {
  const ctrlC = keyboardEvent("c", "KeyC", { ctrlKey: true });
  const cmdC = keyboardEvent("c", "KeyC", { metaKey: true });

  assert.equal(shouldPassThroughCopyShortcut("copy", true, ctrlC), false);
  assert.equal(shouldPassThroughCopyShortcut("copy", true, cmdC), false);
});

test("copy shortcut does not pass through for shifted or alternate chords", () => {
  assert.equal(
    shouldPassThroughCopyShortcut("copy", false, keyboardEvent("C", "KeyC", { ctrlKey: true, shiftKey: true })),
    false,
  );
  assert.equal(
    shouldPassThroughCopyShortcut("copy", false, keyboardEvent("C", "KeyC", { metaKey: true, shiftKey: true })),
    false,
  );
  assert.equal(
    shouldPassThroughCopyShortcut("copy", false, keyboardEvent("l", "KeyL", { ctrlKey: true })),
    false,
  );
  assert.equal(
    shouldPassThroughCopyShortcut("copy", false, keyboardEvent("c", "KeyC", { metaKey: true, ctrlKey: true })),
    false,
  );
  assert.equal(
    shouldPassThroughCopyShortcut("paste", false, keyboardEvent("c", "KeyC", { ctrlKey: true })),
    false,
  );
  assert.equal(
    shouldPassThroughCopyShortcut("paste", false, keyboardEvent("c", "KeyC", { metaKey: true })),
    false,
  );
});

test("plain Ctrl+C copy passthrough follows the physical C key on non-Latin layouts", () => {
  const event = keyboardEvent("\u0441", "KeyC", { ctrlKey: true });

  assert.equal(isPlainCtrlCInterruptChord(event), true);
  assert.equal(shouldPassThroughCopyShortcut("copy", false, event), true);
});

test("plain Cmd+C copy passthrough follows the physical C key on non-Latin layouts", () => {
  const event = keyboardEvent("\u0441", "KeyC", { metaKey: true });

  assert.equal(isPlainMetaCCopyChord(event), true);
  assert.equal(shouldPassThroughCopyShortcut("copy", false, event), true);
});
