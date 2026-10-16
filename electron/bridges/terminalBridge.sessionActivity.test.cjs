"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const terminalBridge = require("./terminalBridge.cjs");

test("renderer terminal input reports activity for the matching session", () => {
  const writes = [];
  const activity = [];
  const sessions = new Map([
    ["session-1", {
      proc: { write: (data) => writes.push(data) },
      webContentsId: 1,
    }],
  ]);
  terminalBridge.init({
    sessions,
    electronModule: { webContents: { fromId: () => null } },
    reportOpenedSessionActivity: (event) => activity.push(event),
  });

  terminalBridge.writeToSession({ sender: {} }, {
    sessionId: "session-1",
    data: "pwd\r",
  });

  assert.deepEqual(writes, ["pwd\r"]);
  assert.deepEqual(activity, [
    { sessionId: "session-1", phase: "touch" },
  ]);
});

test("direct-mode close reports ownership cleanup after the backend already exited", () => {
  const activity = [];
  terminalBridge.init({
    sessions: new Map(),
    electronModule: {},
    reportOpenedSessionActivity: (event) => activity.push(event),
  });

  const result = terminalBridge.closeSession({ sender: {} }, {
    sessionId: "already-exited",
    bootEpoch: 3,
  });

  assert.deepEqual(result, { closed: false, reason: "missing" });
  assert.deepEqual(activity, [{ sessionId: "already-exited", phase: "closed" }]);
});

test("direct-mode disconnect close keeps host_open ownership for reconnect", () => {
  const activity = [];
  const sessions = new Map([
    ["session-keep", {
      proc: { kill() {} },
      webContentsId: 1,
    }],
  ]);
  terminalBridge.init({
    sessions,
    electronModule: { webContents: { fromId: () => ({ isDestroyed: () => true, send() {} }) } },
    reportOpenedSessionActivity: (event) => activity.push(event),
  });

  const result = terminalBridge.closeSession({ sender: {} }, {
    sessionId: "session-keep",
    retainOwnership: true,
  });

  assert.deepEqual(result, { closed: true });
  assert.equal(sessions.has("session-keep"), false);
  assert.deepEqual(activity, []);
});

test("direct-mode disconnect close of an already-exited session keeps ownership", () => {
  const activity = [];
  terminalBridge.init({
    sessions: new Map(),
    electronModule: {},
    reportOpenedSessionActivity: (event) => activity.push(event),
  });

  const result = terminalBridge.closeSession({ sender: {} }, {
    sessionId: "already-exited",
    bootEpoch: 3,
    retainOwnership: true,
  });

  assert.deepEqual(result, { closed: false, reason: "missing" });
  assert.deepEqual(activity, []);
});

test("stale direct-mode close cannot clean up a newer same-id boot", () => {
  const activity = [];
  const { claimSessionSlot } = require("./sessionBootEpoch.cjs");
  const lifecycle = new Map();
  claimSessionSlot(lifecycle, "reconnected", {}, 4);
  lifecycle.delete("reconnected");
  terminalBridge.init({
    sessions: new Map(),
    electronModule: {},
    reportOpenedSessionActivity: (event) => activity.push(event),
  });

  const stale = terminalBridge.closeSession({ sender: {} }, {
    sessionId: "reconnected",
    bootEpoch: 3,
  });
  assert.deepEqual(stale, { skipped: true, reason: "boot-epoch-mismatch" });
  assert.deepEqual(activity, []);

  const current = terminalBridge.closeSession({ sender: {} }, {
    sessionId: "reconnected",
    bootEpoch: 4,
  });
  assert.deepEqual(current, { closed: false, reason: "missing" });
  assert.deepEqual(activity, [{ sessionId: "reconnected", phase: "closed" }]);
});

test("only a submitted non-sensitive user command arms cwd recovery", () => {
  const stream = { write() { return true; } };
  const session = { stream, webContentsId: 1, blockUntargetedCwdProbe: true };
  const sessions = new Map([["session-1", session]]);
  terminalBridge.init({ sessions, electronModule: { webContents: { fromId: () => null } } });

  terminalBridge.writeToSession({ sender: {} }, {
    sessionId: "session-1", data: "pwd", automated: false,
  });
  assert.notEqual(session.pendingCwdRecoveryAfterUserCommand, true);

  terminalBridge.writeToSession({ sender: {} }, {
    sessionId: "session-1", data: "secret\r", sensitive: true,
  });
  assert.notEqual(session.pendingCwdRecoveryAfterUserCommand, true);

  terminalBridge.writeToSession({ sender: {} }, {
    sessionId: "session-1", data: "pwd\r", automated: false,
  });
  assert.equal(session.pendingCwdRecoveryAfterUserCommand, true);
});

test("blocked transfer input and failed writes do not arm cwd recovery", () => {
  const blocked = {
    stream: { write() { throw new Error("must not write during transfer"); } },
    webContentsId: 1,
    blockUntargetedCwdProbe: true,
    zmodemSentry: { isActive: () => true, cancel() {} },
  };
  const failed = {
    stream: { write() { throw Object.assign(new Error("closed"), { code: "EPIPE" }); } },
    webContentsId: 1,
    blockUntargetedCwdProbe: true,
  };
  const sessions = new Map([["blocked", blocked], ["failed", failed]]);
  terminalBridge.init({ sessions, electronModule: { webContents: { fromId: () => null } } });

  terminalBridge.writeToSession({ sender: {} }, { sessionId: "blocked", data: "pwd\r" });
  terminalBridge.writeToSession({ sender: {} }, { sessionId: "failed", data: "pwd\r" });

  assert.notEqual(blocked.pendingCwdRecoveryAfterUserCommand, true);
  assert.notEqual(failed.pendingCwdRecoveryAfterUserCommand, true);
});
