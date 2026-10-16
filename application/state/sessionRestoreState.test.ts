import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAndWriteSessionRestorePayload,
  createInitialRestoredSessionState,
  mergeSessionRestoreCwd,
  patchSessionRestoreActiveTabId,
  resolveSessionRestoreActiveTabWrite,
  updateRestoredSessionStatusState,
  shouldPersistSessionRestoreState,
} from "./sessionRestoreState.ts";
import type { SessionRestorePayload } from "../../domain/sessionRestore.ts";

const payload: SessionRestorePayload = {
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

test("restored session state hydrates sessions, workspaces, tab order, and active tab", () => {
  const restored = createInitialRestoredSessionState({
    restoreEnabled: true,
    payload,
  });

  assert.equal(restored.sessions[0].status, "disconnected");
  assert.equal(restored.sessions[0].restoreState, "restored-disconnected");
  assert.equal(restored.workspaces[0].id, "ws-1");
  assert.deepEqual(restored.tabOrder, ["ws-1"]);
  assert.equal(restored.activeTabId, "ws-1");
});

test("restored session state is empty when restore is disabled", () => {
  const restored = createInitialRestoredSessionState({ restoreEnabled: false, payload });
  assert.deepEqual(restored.sessions, []);
  assert.deepEqual(restored.workspaces, []);
  assert.deepEqual(restored.tabOrder, []);
  assert.equal(restored.activeTabId, "vault");
});

test("mergeSessionRestoreCwd records latest cwd metadata without terminal data", () => {
  const next = mergeSessionRestoreCwd(payload, "s1", "/usr/local/src");
  assert.equal(next.sessions[0].lastCwd, "/usr/local/src");
  assert.equal("terminalData" in next.sessions[0], false);
});

test("mergeSessionRestoreCwd removes cwd when terminal reports null", () => {
  const next = mergeSessionRestoreCwd({
    ...payload,
    sessions: [{ ...payload.sessions[0], lastCwd: "/tmp" }],
  }, "s1", null);
  assert.equal(next.sessions[0].lastCwd, undefined);
});

test("updateRestoredSessionStatusState clears restore marker after reconnect starts", () => {
  const next = updateRestoredSessionStatusState(payload.sessions, "s1", "connecting");

  assert.equal(next[0].status, "connecting");
  assert.equal(next[0].restoreState, undefined);
});

test("updateRestoredSessionStatusState keeps restore marker for disconnected placeholders", () => {
  const next = updateRestoredSessionStatusState(payload.sessions, "s1", "disconnected");

  assert.equal(next[0].status, "disconnected");
  assert.equal(next[0].restoreState, "restored-disconnected");
});

test("shouldPersistSessionRestoreState skips transient empty startup state", () => {
  assert.equal(shouldPersistSessionRestoreState([], [], []), false);
  assert.equal(shouldPersistSessionRestoreState(payload.sessions, payload.workspaces, payload.tabOrder), true);
});

test("restored session state preserves lightweight workspace chrome only", () => {
  const restored = createInitialRestoredSessionState({
    restoreEnabled: true,
    payload: {
      ...payload,
      workspaces: [{
        ...payload.workspaces[0],
        viewMode: "focus",
        focusedSessionId: "s1",
        focusSessionOrder: ["s1"],
        broadcastEnabled: true,
        transientPanelState: { selected: "history" },
      } as never],
    },
  });

  assert.equal(restored.workspaces[0].viewMode, "focus");
  assert.equal(restored.workspaces[0].focusedSessionId, "s1");
  assert.deepEqual(restored.workspaces[0].focusSessionOrder, ["s1"]);
  assert.equal("transientPanelState" in restored.workspaces[0], false);
});

test("session restore flush writes through the same sanitized payload path", () => {
  const writes: SessionRestorePayload[] = [];
  const storage = {
    write: (next: SessionRestorePayload) => {
      writes.push(next);
      return true;
    },
    clear: () => {
      throw new Error("should not clear non-empty restore state");
    },
  };

  const wrote = buildAndWriteSessionRestorePayload({
    sessions: [{
      ...payload.sessions[0],
      status: "connected",
      terminalData: "do-not-store",
    } as never],
    workspaces: [{
      ...payload.workspaces[0],
      transientPanelState: { selected: "history" },
    } as never],
    tabOrder: ["ws-1"],
    activeTabId: "ws-1",
    now: 42,
    storage,
  });

  assert.equal(wrote, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].sessions[0].status, "disconnected");
  assert.equal("terminalData" in writes[0].sessions[0], false);
  assert.equal("transientPanelState" in writes[0].workspaces[0], false);
  assert.equal(writes[0].savedAt, 42);
});

test("patchSessionRestoreActiveTabId updates only activeTabId without rebuilding sessions", () => {
  const writes: SessionRestorePayload[] = [];
  const storage = {
    write: (next: SessionRestorePayload) => {
      writes.push(next);
      return true;
    },
  };

  const first = patchSessionRestoreActiveTabId({
    activeTabId: "session-2",
    now: 99,
    cachedPayload: payload,
    storage,
  });
  assert.equal(first.status, "patched");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].activeTabId, "session-2");
  assert.equal(writes[0].savedAt, 99);
  // Sessions array identity preserved (no rebuild from live app state).
  assert.equal(writes[0].sessions, payload.sessions);
  assert.equal(writes[0].workspaces, payload.workspaces);

  const second = patchSessionRestoreActiveTabId({
    activeTabId: "session-2",
    now: 100,
    cachedPayload: writes[0],
    storage,
  });
  assert.equal(second.status, "unchanged");
  assert.equal(writes.length, 1);

  const missing = patchSessionRestoreActiveTabId({
    activeTabId: "session-3",
    cachedPayload: null,
    storage: { write: storage.write },
  });
  assert.equal(missing.status, "missing");
  assert.equal(writes.length, 1);
});

test("resolveSessionRestoreActiveTabWrite forces full rebuild when cache is null", () => {
  assert.deepEqual(
    resolveSessionRestoreActiveTabWrite({ activeTabId: "new-tab", cachedPayload: null }),
    { kind: "full" },
  );
  assert.deepEqual(
    resolveSessionRestoreActiveTabWrite({ activeTabId: "ws-1", cachedPayload: payload }),
    { kind: "noop" },
  );
  assert.deepEqual(
    resolveSessionRestoreActiveTabWrite({ activeTabId: "session-2", cachedPayload: payload }),
    { kind: "patch", base: payload },
  );
});

test("null cache never patches from stale storage.read (would corrupt restore)", () => {
  // Simulated: effect recreated after connect — lastFullPayload is null, but
  // disk still has the pre-connect payload (missing the new session).
  const staleOnDisk: SessionRestorePayload = {
    ...payload,
    sessions: [{ ...payload.sessions[0], id: "old-only" }],
    activeTabId: "old-only",
  };
  let diskWrite: SessionRestorePayload | null = null;
  const writes: SessionRestorePayload[] = [];

  // Decision layer: must request full rebuild, not patch.
  assert.equal(
    resolveSessionRestoreActiveTabWrite({
      activeTabId: "new-session-after-connect",
      cachedPayload: null,
    }).kind,
    "full",
  );

  // Shipped patch helper must refuse to write stale sessions + new activeTabId.
  const patched = patchSessionRestoreActiveTabId({
    activeTabId: "new-session-after-connect",
    now: 123,
    cachedPayload: null,
    storage: {
      write: (next) => {
        writes.push(next);
        diskWrite = next;
        return true;
      },
    },
  });
  assert.equal(patched.status, "missing");
  assert.equal(writes.length, 0);
  assert.equal(diskWrite, null);

  // Contrast: if we wrongly patched from disk, restore would lose the new session.
  const wrongBase = staleOnDisk;
  const corrupt = {
    ...wrongBase,
    activeTabId: "new-session-after-connect",
  };
  assert.equal(corrupt.sessions.some((s) => s.id === "new-session-after-connect"), false);
  assert.equal(corrupt.activeTabId, "new-session-after-connect");
});

test("rapid active-tab patches do not call full payload builders", async () => {
  // Structural: patch path only spreads the cached payload; full builds go
  // through buildAndWriteSessionRestorePayload / buildPersistableSessionRestorePayload.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./sessionRestoreState.ts", import.meta.url), "utf8");
  assert.match(source, /export function patchSessionRestoreActiveTabId/);
  assert.match(source, /export function resolveSessionRestoreActiveTabWrite/);
  assert.match(source, /activeTabId/);
  // patch must not call buildSessionRestorePayload or fall back to storage.read.
  const patchStart = source.indexOf("export function patchSessionRestoreActiveTabId");
  const patchBody = source.slice(patchStart, patchStart + 1200);
  assert.doesNotMatch(patchBody, /buildSessionRestorePayload/);
  assert.doesNotMatch(patchBody, /buildPersistableSessionRestorePayload/);
  assert.doesNotMatch(patchBody, /storage\.read/);
});

test("session restore flush clears storage instead of writing when restore is disabled", () => {
  const writes: SessionRestorePayload[] = [];
  let clearCount = 0;
  const storage = {
    write: (next: SessionRestorePayload) => {
      writes.push(next);
      return true;
    },
    clear: () => {
      clearCount += 1;
    },
  };

  const wrote = buildAndWriteSessionRestorePayload({
    restoreEnabled: false,
    sessions: payload.sessions,
    workspaces: payload.workspaces,
    tabOrder: payload.tabOrder,
    activeTabId: payload.activeTabId,
    storage,
  });

  assert.equal(wrote, false);
  assert.equal(clearCount, 1);
  assert.equal(writes.length, 0);
});

test("session restore flush skips empty transient windows without clearing existing snapshots", () => {
  const writes: SessionRestorePayload[] = [];
  let clearCount = 0;
  const storage = {
    write: (next: SessionRestorePayload) => {
      writes.push(next);
      return true;
    },
    clear: () => {
      clearCount += 1;
    },
  };

  const wrote = buildAndWriteSessionRestorePayload({
    sessions: [],
    workspaces: [],
    tabOrder: [],
    activeTabId: "vault",
    storage,
  });

  assert.equal(wrote, false);
  assert.equal(clearCount, 0);
  assert.equal(writes.length, 0);
});

test("session restore flush clears stale snapshots when main window becomes empty after restorable state existed", () => {
  const writes: SessionRestorePayload[] = [];
  let clearCount = 0;
  const storage = {
    write: (next: SessionRestorePayload) => {
      writes.push(next);
      return true;
    },
    clear: () => {
      clearCount += 1;
    },
  };

  const wrote = buildAndWriteSessionRestorePayload({
    sessions: [],
    workspaces: [],
    tabOrder: [],
    activeTabId: "vault",
    clearOnEmpty: true,
    storage,
  });

  assert.equal(wrote, false);
  assert.equal(clearCount, 1);
  assert.equal(writes.length, 0);
});
