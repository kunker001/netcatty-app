import test from "node:test";
import assert from "node:assert/strict";

import { resolveCloseIntent } from "./resolveCloseIntent.ts";

const baseWorkspace = { id: "w1", focusedSessionId: "s1" };
const baseSession = { id: "s1" };

test("non-workspace tab → closeSingleTab with session id", () => {
  const r = resolveCloseIntent({
    activeTabId: "s1",
    workspace: null,
    sessionForTab: baseSession,
    focusIsInsideTerminal: true,
  });
  assert.deepEqual(r, { kind: "closeSingleTab", sessionId: "s1" });
});

test("non-workspace session tab → closeSingleTab even when focus is outside the terminal", () => {
  const r = resolveCloseIntent({
    activeTabId: "s1",
    workspace: null,
    sessionForTab: { id: "s1" },
    focusIsInsideTerminal: false,
  });
  assert.deepEqual(r, { kind: "closeSingleTab", sessionId: "s1" });
});

test("vault/sftp tab → noop", () => {
  const r = resolveCloseIntent({
    activeTabId: "vault",
    workspace: null,
    sessionForTab: null,
    focusIsInsideTerminal: false,
  });
  assert.deepEqual(r, { kind: "noop" });
});

test("workspace + focus in terminal → closeTerminal (side panel no longer intercepts)", () => {
  const r = resolveCloseIntent({
    activeTabId: "w1",
    workspace: baseWorkspace,
    sessionForTab: null,
    focusIsInsideTerminal: true,
  });
  assert.deepEqual(r, { kind: "closeTerminal", sessionId: "s1" });
});

test("workspace + focus NOT in terminal → closeWorkspace", () => {
  const r = resolveCloseIntent({
    activeTabId: "w1",
    workspace: baseWorkspace,
    sessionForTab: null,
    focusIsInsideTerminal: false,
  });
  assert.deepEqual(r, { kind: "closeWorkspace", workspaceId: "w1" });
});

test("workspace with no focused session → closeWorkspace", () => {
  const r = resolveCloseIntent({
    activeTabId: "w1",
    workspace: { id: "w1", focusedSessionId: undefined },
    sessionForTab: null,
    focusIsInsideTerminal: true,
  });
  assert.deepEqual(r, { kind: "closeWorkspace", workspaceId: "w1" });
});
