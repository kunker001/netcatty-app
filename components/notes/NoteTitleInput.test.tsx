import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./NoteTitleInput.tsx", import.meta.url), "utf8");
const managerSource = readFileSync(new URL("./NotesManager.tsx", import.meta.url), "utf8");

test("NoteTitleInput keeps a local draft and only commits when IME composition is idle", () => {
  assert.match(source, /shouldCommitImeControlledChange/);
  assert.match(source, /shouldAdoptExternalImeControlledValue/);
  assert.match(source, /onCompositionStart=\{/);
  assert.match(source, /onCompositionEnd=\{/);
  assert.match(source, /value=\{draft\}/);
  assert.doesNotMatch(
    source,
    /onChange=\{\(event\) => onCommit\(event\.target\.value\)\}/,
  );
});

test("NoteTitleInput stashes live drafts during composition without idle-only commits", () => {
  assert.match(source, /onLiveDraft\?\.\(next\)/);
  assert.match(source, /onLiveDraft\?: \(title: string\) => void/);
});

test("NoteTitleInput commits the local draft on blur before parent flush", () => {
  assert.match(source, /onBlur=\{\(event\) => \{/);
  assert.match(source, /onCommit\(next\)/);
  assert.match(source, /onCommit\(value\)/);
  assert.match(source, /onBlur\?\.\(\)/);
});

test("NoteTitleInput clears live-stashed title when composition is externally superseded", () => {
  assert.match(
    source,
    /supersededRef\.current = true;[\s\S]*?setDraft\(value\);[\s\S]*?onLiveDraft\?\.\(value\)/,
  );
  assert.match(source, /adoptedExternal/);
  assert.match(source, /onLiveDraftRef\.current\?\.\(adoptedExternal\)/);
});

test("NotesManager cancels debounced flush while stashing IME title drafts", () => {
  assert.match(
    managerSource,
    /clearDraftTimer\(\);[\s\S]*?draftNoteIdRef\.current = note\.id;[\s\S]*?draftTitleRef\.current = title/,
  );
});

test("NoteTitleInput resets IME guards when the active note changes", () => {
  assert.match(source, /noteId/);
  assert.match(
    source,
    /composingRef\.current = false;[\s\S]*?supersededRef\.current = false;[\s\S]*?setDraft\(value\)/,
  );
});

test("NotesManager title rows use NoteTitleInput instead of raw controlled saves", () => {
  assert.match(managerSource, /NoteTitleInput/);
  assert.match(managerSource, /data-note-title-row/);
  assert.match(managerSource, /onCommit=\{\(title\) => saveNoteTitleDraft/);
  assert.doesNotMatch(
    managerSource,
    /data-note-title-row[\s\S]{0,500}<input[\s\S]{0,250}onChange=\{\(event\) => saveNoteTitleDraft/,
  );
});

test("NotesManager title rows stash live IME drafts into refs", () => {
  assert.match(managerSource, /stashNoteTitleDraft/);
  assert.match(managerSource, /onLiveDraft=\{\(title\) => stashNoteTitleDraft/);
  assert.match(managerSource, /draftTitleRef\.current = title/);
});
