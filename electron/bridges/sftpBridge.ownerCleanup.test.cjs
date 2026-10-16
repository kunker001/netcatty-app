const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  _createRendererSftpOwnershipForTests: createRendererSftpOwnership,
  init,
  registerHandlers,
} = require("./sftpBridge.cjs");

function sender(id) {
  const value = new EventEmitter();
  value.id = id;
  value.isDestroyed = () => value.destroyed === true;
  value.destroyed = false;
  value.destroy = () => {
    value.destroyed = true;
    value.emit("destroyed");
  };
  return value;
}

function registerWorkerHandlers(request, reportOpenedSessionActivity) {
  const handlers = new Map();
  init({
    electronModule: null,
    reportOpenedSessionActivity,
    sessions: new Map(),
    sftpClients: new Map(),
  });
  registerHandlers({
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
  }, {
    terminalWorkerManager: { request },
  });
  return handlers;
}

test("destroying a renderer closes every SFTP handle it opened", async () => {
  const closed = [];
  const ownership = createRendererSftpOwnership(async (sftpId) => { closed.push(sftpId); });
  const owner = sender(1);
  await ownership.run("netcatty:sftp:open", { sender: owner }, {}, async () => ({ sftpId: "sftp-1" }));

  owner.destroy();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(closed, ["sftp-1"]);
});

test("an SFTP open that finishes after renderer destruction is closed immediately", async () => {
  const closed = [];
  const ownership = createRendererSftpOwnership(async (sftpId) => { closed.push(sftpId); });
  const owner = sender(2);
  let finishOpen;
  const pending = ownership.run("netcatty:sftp:open", { sender: owner }, {}, () => (
    new Promise((resolve) => { finishOpen = resolve; })
  ));

  owner.destroy();
  finishOpen({ sftpId: "sftp-late" });
  await pending;
  assert.deepEqual(closed, ["sftp-late"]);
});

test("an explicitly closed SFTP handle is not closed again on renderer destruction", async () => {
  const closed = [];
  const ownership = createRendererSftpOwnership(async (sftpId) => { closed.push(sftpId); });
  const owner = sender(3);
  await ownership.run("netcatty:sftp:open", { sender: owner }, {}, async () => ({ sftpId: "sftp-3" }));
  await ownership.run(
    "netcatty:sftp:close",
    { sender: owner },
    { sftpId: "sftp-3" },
    async () => ({ success: true }),
  );

  owner.destroy();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(closed, []);
});

test("renderer destruction does not close an SFTP handle again while explicit close is pending", async () => {
  const ownerCleanupCloses = [];
  const ownership = createRendererSftpOwnership(async (sftpId) => {
    ownerCleanupCloses.push(sftpId);
  });
  const owner = sender(31);
  await ownership.run(
    "netcatty:sftp:open",
    { sender: owner },
    {},
    async () => ({ sftpId: "sftp-pending-close" }),
  );
  let finishExplicitClose;
  let explicitCloseCalls = 0;
  const explicitClose = ownership.run(
    "netcatty:sftp:close",
    { sender: owner },
    { sftpId: "sftp-pending-close" },
    () => {
      explicitCloseCalls += 1;
      return new Promise((resolve) => { finishExplicitClose = resolve; });
    },
  );

  owner.destroy();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ownerCleanupCloses, []);

  finishExplicitClose({ success: true });
  await explicitClose;
  assert.equal(explicitCloseCalls, 1);
  assert.deepEqual(ownerCleanupCloses, []);
});

test("renderer destruction removes the source-session association for its SFTP handle", async () => {
  const activity = [];
  const closed = [];
  const handlers = registerWorkerHandlers(async (channel, payload) => {
    if (channel === "netcatty:sftp:openForSession") return { sftpId: "sftp-owned" };
    if (channel === "netcatty:sftp:close") closed.push(payload.sftpId);
    return { success: true };
  }, (event) => activity.push(event));
  const owner = sender(4);

  await handlers.get("netcatty:sftp:openForSession")(
    { sender: owner },
    { sessionId: "terminal-source" },
  );
  owner.destroy();
  await new Promise((resolve) => setImmediate(resolve));

  activity.length = 0;
  await handlers.get("netcatty:sftp:list")(
    { sender: sender(40) },
    { sftpId: "sftp-owned", path: "/" },
  );
  assert.deepEqual(closed, ["sftp-owned"]);
  assert.deepEqual(activity, []);
});

test("a late SFTP open does not restore its destroyed renderer source-session association", async () => {
  const activity = [];
  const closed = [];
  let finishOpen;
  const handlers = registerWorkerHandlers((channel, payload) => {
    if (channel === "netcatty:sftp:openForSession") {
      return new Promise((resolve) => { finishOpen = resolve; });
    }
    if (channel === "netcatty:sftp:close") closed.push(payload.sftpId);
    return Promise.resolve({ success: true });
  }, (event) => activity.push(event));
  const owner = sender(5);

  const pending = handlers.get("netcatty:sftp:openForSession")(
    { sender: owner },
    { sessionId: "terminal-late-source" },
  );
  owner.destroy();
  finishOpen({ sftpId: "sftp-late-owned" });
  await pending;

  activity.length = 0;
  await handlers.get("netcatty:sftp:list")(
    { sender: sender(50) },
    { sftpId: "sftp-late-owned", path: "/" },
  );
  assert.deepEqual(closed, ["sftp-late-owned"]);
  assert.deepEqual(activity, []);
});
