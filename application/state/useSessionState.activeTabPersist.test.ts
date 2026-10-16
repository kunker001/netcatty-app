import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildAndWriteSessionRestorePayload,
  patchSessionRestoreActiveTabId,
  resolveSessionRestoreActiveTabWrite,
} from "./sessionRestoreState.ts";
import type { SessionRestorePayload } from "../../domain/sessionRestore.ts";

const source = readFileSync(new URL("./useSessionState.ts", import.meta.url), "utf8");

const basePayload: SessionRestorePayload = {
  version: 1,
  savedAt: 1,
  activeTabId: "ws-1",
  tabOrder: ["ws-1"],
  sessions: [{
    id: "s1",
    hostId: "host-s1",
    hostLabel: "Host s1",
    hostname: "s1.example.test",
    username: "root",
    status: "disconnected",
    workspaceId: "ws-1",
    restoreState: "restored-disconnected",
  }],
  workspaces: [{
    id: "ws-1",
    title: "Workspace",
    root: { id: "pane-1", type: "pane", sessionId: "s1" },
  }],
};

test("active-tab changes use patchSessionRestoreActiveTabId not full schedulePersist", () => {
  assert.match(source, /patchSessionRestoreActiveTabId/);
  assert.match(source, /scheduleActiveTabPatch/);
  // Active-tab subscription must call the patch scheduler, not the full persist.
  assert.match(
    source,
    /activeTabStore\.subscribeSync\(scheduleActiveTabPatch\)/,
  );
  // Full structural persist remains for sessions/workspaces/tabOrder + pagehide.
  assert.match(source, /scheduleSessionRestorePersistRef\.current = schedulePersist/);
  assert.match(source, /pagehide/);
  assert.match(source, /beforeunload/);
  // Null cache must re-schedule full persist, never storage.read as patch base.
  assert.match(source, /if \(!lastFullPayload\)/);
  assert.match(source, /schedulePersist\(\)/);
  assert.doesNotMatch(
    source.slice(source.indexOf("scheduleActiveTabPatch"), source.indexOf("scheduleActiveTabPatch") + 900),
    /sessionRestoreStorage\.read/,
  );
});

/**
 * Drives the shipped decision + write helpers the way useSessionState does:
 * - after sessions change, lastFullPayload is null (effect recreated)
 * - disk still has the previous (stale) snapshot
 * - active tab flips to a new session id
 * Correct path: kind 'full' → buildAndWriteSessionRestorePayload from LIVE state.
 * Wrong path: patch from disk → old sessions + new activeTabId.
 */
test("null cache with stale disk forces full rebuild from live sessions (shipped path)", () => {
  const staleOnDisk: SessionRestorePayload = {
    ...basePayload,
    sessions: [{ ...basePayload.sessions[0], id: "pre-connect-only" }],
    tabOrder: ["pre-connect-only"],
    activeTabId: "pre-connect-only",
  };

  // Live state after connect (what persistNow would serialize).
  const liveSessions = [
    staleOnDisk.sessions[0],
    {
      id: "new-session-after-connect",
      hostId: "host-new",
      hostLabel: "New host",
      hostname: "new.example.test",
      username: "root",
      status: "disconnected" as const,
    },
  ];
  const liveWorkspaces = basePayload.workspaces;
  const liveTabOrder = ["pre-connect-only", "new-session-after-connect"];
  const activeTabId = "new-session-after-connect";

  // 1) Decision: no trusted cache → full.
  const decision = resolveSessionRestoreActiveTabWrite({
    activeTabId,
    cachedPayload: null,
  });
  assert.equal(decision.kind, "full");

  // 2) Patch helper must not write when cache is null (even if disk is full of data).
  const patchWrites: SessionRestorePayload[] = [];
  const patchResult = patchSessionRestoreActiveTabId({
    activeTabId,
    cachedPayload: null,
    storage: {
      write: (next) => {
        patchWrites.push(next);
        return true;
      },
    },
  });
  assert.equal(patchResult.status, "missing");
  assert.equal(patchWrites.length, 0);

  // 3) Full rebuild from live state (what schedulePersist → persistNow does).
  const fullWrites: SessionRestorePayload[] = [];
  const wrote = buildAndWriteSessionRestorePayload({
    sessions: liveSessions,
    workspaces: liveWorkspaces,
    tabOrder: liveTabOrder,
    activeTabId,
    now: 500,
    storage: {
      write: (next) => {
        fullWrites.push(next);
        return true;
      },
      clear: () => {
        throw new Error("should not clear when live state is non-empty");
      },
    },
  });
  assert.equal(wrote, true);
  assert.equal(fullWrites.length, 1);
  assert.equal(fullWrites[0].activeTabId, "new-session-after-connect");
  assert.ok(
    fullWrites[0].sessions.some((s) => s.id === "new-session-after-connect"),
    "full rebuild must include the newly connected session",
  );

  // 4) Prove the corruption that storage-backed patch would have caused.
  const corruptIfPatchedFromDisk = {
    ...staleOnDisk,
    activeTabId: "new-session-after-connect",
  };
  assert.equal(
    corruptIfPatchedFromDisk.sessions.some((s) => s.id === "new-session-after-connect"),
    false,
    "stale-disk patch would drop the new session from restore",
  );
});
