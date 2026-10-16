import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveSupersededImeInputEvent,
  shouldAdoptExternalImeControlledValue,
  shouldCommitImeControlledChange,
} from "./imeControlledInput.ts";

test("does not commit controlled changes while an IME composition session is open", () => {
  assert.equal(
    shouldCommitImeControlledChange({
      isComposingSession: true,
      nativeEventIsComposing: true,
    }),
    false,
  );
  assert.equal(
    shouldCommitImeControlledChange({
      isComposingSession: true,
      nativeEventIsComposing: false,
    }),
    false,
  );
});

test("does not commit when the native event still reports composing", () => {
  assert.equal(
    shouldCommitImeControlledChange({
      isComposingSession: false,
      nativeEventIsComposing: true,
    }),
    false,
  );
});

test("commits ordinary keystrokes outside composition", () => {
  assert.equal(
    shouldCommitImeControlledChange({
      isComposingSession: false,
      nativeEventIsComposing: false,
    }),
    true,
  );
  assert.equal(
    shouldCommitImeControlledChange({
      isComposingSession: false,
    }),
    true,
  );
});

test("does not commit when composition was externally superseded", () => {
  assert.equal(
    shouldCommitImeControlledChange({
      isComposingSession: false,
      nativeEventIsComposing: false,
      compositionExternallySuperseded: true,
    }),
    false,
  );
  assert.equal(
    shouldCommitImeControlledChange({
      isComposingSession: true,
      nativeEventIsComposing: false,
      compositionExternallySuperseded: true,
    }),
    false,
  );
});

test("adopts external value into draft only when not composing and values differ", () => {
  assert.equal(
    shouldAdoptExternalImeControlledValue({
      isComposingSession: false,
      draftValue: "sou",
      externalValue: "",
    }),
    true,
  );
  assert.equal(
    shouldAdoptExternalImeControlledValue({
      isComposingSession: true,
      draftValue: "sou",
      externalValue: "",
    }),
    false,
  );
  assert.equal(
    shouldAdoptExternalImeControlledValue({
      isComposingSession: false,
      draftValue: "搜",
      externalValue: "搜",
    }),
    false,
  );
});

test("adopts external navigation-clear mid-composition when compose-start baseline is provided", () => {
  // Parent cleared filter for different-directory navigation while IME was open.
  assert.equal(
    shouldAdoptExternalImeControlledValue({
      isComposingSession: true,
      draftValue: "sou",
      externalValue: "",
      valueAtComposeStart: "old",
    }),
    true,
  );
  // External value still matches the compose-start baseline - keep draft for IME.
  assert.equal(
    shouldAdoptExternalImeControlledValue({
      isComposingSession: true,
      draftValue: "sou",
      externalValue: "old",
      valueAtComposeStart: "old",
    }),
    false,
  );
  // Draft already matches external after a prior adopt - no-op.
  assert.equal(
    shouldAdoptExternalImeControlledValue({
      isComposingSession: true,
      draftValue: "",
      externalValue: "",
      valueAtComposeStart: "old",
    }),
    false,
  );
});

test("suppresses post-composition onChange after external supersede and clears the latch once ended", () => {
  // Mid-composition after navigation clear: ignore event, keep latch armed.
  assert.deepEqual(
    resolveSupersededImeInputEvent({
      compositionExternallySuperseded: true,
      isComposingSession: true,
      nativeEventIsComposing: true,
    }),
    { ignoreEventValue: true, clearSupersedeLatch: false },
  );

  // Post-compositionend follow-up change (composing=false): ignore once and clear.
  assert.deepEqual(
    resolveSupersededImeInputEvent({
      compositionExternallySuperseded: true,
      isComposingSession: false,
      nativeEventIsComposing: false,
    }),
    { ignoreEventValue: true, clearSupersedeLatch: true },
  );

  // No supersede: ordinary path.
  assert.deepEqual(
    resolveSupersededImeInputEvent({
      compositionExternallySuperseded: false,
      isComposingSession: false,
      nativeEventIsComposing: false,
    }),
    { ignoreEventValue: false, clearSupersedeLatch: false },
  );
});

test("ordinary commits remain blocked only while the supersede latch is armed", () => {
  // Documents the stuck-latch failure mode: if compositionend arms the latch and
  // no post-composition onChange clears it, shouldCommitImeControlledChange stays
  // false for ordinary keystrokes. UI must clear via onChange or a deferred fallback.
  assert.equal(
    shouldCommitImeControlledChange({
      isComposingSession: false,
      nativeEventIsComposing: false,
      compositionExternallySuperseded: true,
    }),
    false,
  );
  assert.equal(
    shouldCommitImeControlledChange({
      isComposingSession: false,
      nativeEventIsComposing: false,
      compositionExternallySuperseded: false,
    }),
    true,
  );
});
