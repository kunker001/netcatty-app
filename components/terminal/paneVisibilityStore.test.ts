import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  getPaneVisible,
  hasPaneVisibilityEntry,
  removePaneVisible,
  resolvePaneVisible,
  setPaneVisible,
} from "./paneVisibilityStore.ts";

const SESSION_ID = "test-session-popup-fallback";

test("resolvePaneVisible falls back to the prop when the store has no entry", () => {
  removePaneVisible(SESSION_ID);
  assert.equal(hasPaneVisibilityEntry(SESSION_ID), false);
  assert.equal(getPaneVisible(SESSION_ID), false);
  assert.equal(resolvePaneVisible(SESSION_ID, true), true);
  assert.equal(resolvePaneVisible(SESSION_ID, false), false);
});

test("resolvePaneVisible prefers the store when an entry exists", () => {
  setPaneVisible(SESSION_ID, false);
  assert.equal(resolvePaneVisible(SESSION_ID, true), false);
  setPaneVisible(SESSION_ID, true);
  assert.equal(resolvePaneVisible(SESSION_ID, false), true);
  removePaneVisible(SESSION_ID);
});

test("usePaneVisible source falls back through resolvePaneVisible", () => {
  // Keep the hook contract aligned with hibernate: missing store entries must
  // not force-hide popup/standalone terminals that never publish visibility.
  const source = readFileSync(fileURLToPath(new URL("./paneVisibilityStore.ts", import.meta.url)), "utf8");
  assert.match(source, /resolvePaneVisible\(sessionId, fallbackVisible\)/);
  assert.match(source, /export function usePaneVisible\(sessionId: string, fallbackVisible = false\)/);
});
