const test = require("node:test");
const assert = require("node:assert/strict");

const terminalBridge = require("./terminalBridge.cjs");
const {
  createConnectionRef,
  acquireConnectionRef,
  discardTransport,
  resetSshTransportRegistryForTests,
} = require("./sshConnectionPool.cjs");

// Verifies the terminalBridge close path respects connection multiplexing
// (issue #1204): closing one tab that shares an SSH connection must only close
// that tab's channel. Once the last tab is gone, the transport is parked briefly
// so a later same-host open can reuse it without another authentication round.

test.beforeEach(() => {
  resetSshTransportRegistryForTests();
});

test.afterEach(() => {
  resetSshTransportRegistryForTests();
});

function makeStream() {
  return {
    closed: 0,
    close() { this.closed += 1; },
  };
}

function makeConn() {
  return {
    ended: 0,
    end() { this.ended += 1; },
  };
}

function makeSession(conn, connRef) {
  return {
    stream: makeStream(),
    conn,
    chainConnections: [],
    connRef,
    zmodemSentry: { cancel() {} },
  };
}

test("closing a reused SSH tab keeps the shared connection alive", () => {
  const sessions = new Map();
  terminalBridge.init({ sessions, electronModule: {} });

  const conn = makeConn();
  const owner = makeSession(conn, null);
  const connRef = createConnectionRef(owner, conn, []);
  const copy = makeSession(conn, null);
  acquireConnectionRef(copy, connRef);

  sessions.set("owner", owner);
  sessions.set("copy", copy);
  assert.equal(connRef.count, 2);

  // Close the copy tab.
  terminalBridge.closeSession({ sender: {} }, { sessionId: "copy" });

  assert.equal(copy.stream.closed, 1, "copy channel closed");
  assert.equal(conn.ended, 0, "shared connection must stay up for the owner");
  assert.equal(connRef.count, 1);
  assert.equal(sessions.has("copy"), false);

  // Close the owner tab — now the last holder, so the connection is parked.
  terminalBridge.closeSession({ sender: {} }, { sessionId: "owner" });
  assert.equal(owner.stream.closed, 1, "owner channel closed");
  assert.equal(conn.ended, 0, "connection remains parked for same-host reuse");
  assert.equal(connRef.count, 0);
  assert.equal(connRef.state, "idle");
  assert.equal(discardTransport(connRef), true);
  assert.equal(conn.ended, 1, "parked connection is still reclaimable");
});

test("closing the owner tab first does not strand the copy's connection", () => {
  const sessions = new Map();
  terminalBridge.init({ sessions, electronModule: {} });

  const conn = makeConn();
  const owner = makeSession(conn, null);
  const connRef = createConnectionRef(owner, conn, []);
  const copy = makeSession(conn, null);
  acquireConnectionRef(copy, connRef);

  sessions.set("owner", owner);
  sessions.set("copy", copy);

  // Close the owner first.
  terminalBridge.closeSession({ sender: {} }, { sessionId: "owner" });
  assert.equal(conn.ended, 0, "connection survives for the still-open copy");
  assert.equal(connRef.count, 1);

  // Closing the copy (now last) parks the connection for reuse.
  terminalBridge.closeSession({ sender: {} }, { sessionId: "copy" });
  assert.equal(conn.ended, 0);
  assert.equal(connRef.state, "idle");
  assert.equal(discardTransport(connRef), true);
  assert.equal(conn.ended, 1);
});

test("legacy SSH session without connRef still ends its own connection + chain", () => {
  const sessions = new Map();
  terminalBridge.init({ sessions, electronModule: {} });

  const conn = makeConn();
  const chain = [makeConn(), makeConn()];
  const session = {
    stream: makeStream(),
    conn,
    chainConnections: chain,
    connRef: null,
    zmodemSentry: { cancel() {} },
  };
  sessions.set("legacy", session);

  terminalBridge.closeSession({ sender: {} }, { sessionId: "legacy" });
  assert.equal(session.stream.closed, 1);
  assert.equal(conn.ended, 1, "non-multiplexed connection ends directly");
  assert.equal(chain[0].ended, 1);
  assert.equal(chain[1].ended, 1);
});
