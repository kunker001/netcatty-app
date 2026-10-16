const assert = require("node:assert/strict");
const { EventEmitter, once } = require("node:events");
const net = require("node:net");
const test = require("node:test");

const {
  _bindPortForwardChannelsForTests: bindPortForwardChannels,
  _attachTunnelPipeStreamForTests: attachTunnelPipeStream,
  _clearPortForwardTunnelsForTests: clearPortForwardTunnels,
  _destroyTunnelPipesForTests: destroyTunnelPipes,
  _trackTunnelPipeForTests: trackTunnelPipe,
  cancelTunnel,
} = require("./portForwardingBridge.cjs");

function fakeEndpoint() {
  const endpoint = new EventEmitter();
  endpoint.destroyedByTest = false;
  endpoint.destroyCalls = 0;
  endpoint.destroy = () => {
    endpoint.destroyCalls += 1;
    endpoint.destroyedByTest = true;
  };
  endpoint.end = () => { endpoint.destroyedByTest = true; };
  endpoint.close = () => { endpoint.destroyedByTest = true; };
  return endpoint;
}

test("accepted sockets are tracked before forwardOut finishes and stop destroys them", () => {
  const tunnel = { cancelled: false, activePipes: new Set() };
  const socket = fakeEndpoint();
  const entry = trackTunnelPipe(tunnel, socket);
  assert.equal(tunnel.activePipes.size, 1);

  destroyTunnelPipes(tunnel);
  assert.equal(socket.destroyedByTest, true);
  assert.equal(entry.openAbortController, null);
  assert.equal(tunnel.activePipes.size, 0);
});

test("client disconnect drops only its pending channel open", () => {
  const tunnel = { cancelled: false, activePipes: new Set() };
  const socket = fakeEndpoint();
  const entry = trackTunnelPipe(tunnel, socket);
  entry.openStarted = true;
  let aborts = 0;
  entry.openAbortController.signal.addEventListener("abort", () => { aborts += 1; });

  socket.emit("close");

  assert.equal(aborts, 0);
  assert.equal(entry.closed, true);
  assert.equal(entry.openAbortController.signal.aborted, false);
  assert.equal(tunnel.activePipes.size, 1);
  const destroyCalls = socket.destroyCalls;

  socket.emit("error", new Error("client closed"));
  assert.equal(socket.destroyCalls, destroyCalls);

  destroyTunnelPipes(tunnel);

  assert.equal(aborts, 1);
  assert.equal(tunnel.activePipes.size, 0);
});

test("a client disconnect does not close the local forwarding listener", async () => {
  let finishForwardOut;
  let transportEnds = 0;
  let transportDestroys = 0;
  const conn = new EventEmitter();
  conn.forwardOut = (_sourceAddress, _sourcePort, _targetAddress, _targetPort, callback) => {
    finishForwardOut = callback;
  };
  conn.end = () => { transportEnds += 1; };
  conn.destroy = () => { transportDestroys += 1; };
  const tunnel = {
    tunnelId: "pf-client-disconnect",
    cancelled: false,
    activePipes: new Set(),
    chainConnections: [],
    sshTransportManaged: false,
  };
  const sender = { id: 1, isDestroyed: () => false };

  const started = await bindPortForwardChannels({
    type: "local",
    conn,
    tunnelId: tunnel.tunnelId,
    tunnelState: tunnel,
    sender,
    bindAddress: "127.0.0.1",
    localPort: 0,
    remoteHost: "127.0.0.1",
    remotePort: 22,
    chainConnections: [],
    sendStatus() {},
  });
  assert.equal(started.success, true);

  const client = net.connect(tunnel.server.address().port, "127.0.0.1");
  await once(client, "connect");
  client.destroy();
  await once(client, "close");
  assert.equal(tunnel.server.listening, true);

  finishForwardOut(new Error("client closed"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(transportEnds, 0);
  assert.equal(transportDestroys, 0);

  await new Promise((resolve, reject) => tunnel.server.close((error) => error ? reject(error) : resolve()));
});

test("a disconnected SOCKS client remains cancellable until its channel open settles", async () => {
  let finishForwardOut;
  let forwardOutStarted;
  const conn = new EventEmitter();
  conn.forwardOut = (_sourceAddress, _sourcePort, _targetAddress, _targetPort, callback) => {
    finishForwardOut = callback;
    forwardOutStarted?.();
  };
  conn.end = () => {};
  conn.destroy = () => {};
  const tunnel = {
    tunnelId: "pf-socks-client-disconnect",
    cancelled: false,
    activePipes: new Set(),
    chainConnections: [],
    sshTransportManaged: false,
  };
  const sender = { id: 2, isDestroyed: () => false };

  try {
    const started = await bindPortForwardChannels({
      type: "dynamic",
      conn,
      tunnelId: tunnel.tunnelId,
      tunnelState: tunnel,
      sender,
      bindAddress: "127.0.0.1",
      localPort: 0,
      remoteHost: "127.0.0.1",
      remotePort: 22,
      chainConnections: [],
      sendStatus() {},
    });
    assert.equal(started.success, true);

    const client = net.connect(tunnel.server.address().port, "127.0.0.1");
    await once(client, "connect");
    client.write(Buffer.from([0x05, 0x01, 0x00]));
    await once(client, "data");
    const channelStarted = new Promise((resolve) => { forwardOutStarted = resolve; });
    client.write(Buffer.from([0x05, 0x01, 0x00, 0x01, 127, 0, 0, 1, 0, 22]));
    await channelStarted;
    client.destroy();
    await once(client, "close");
    assert.equal(tunnel.server.listening, true);
    assert.equal(tunnel.activePipes.size, 1);

    await cancelTunnel(tunnel.tunnelId, tunnel, () => {});
    assert.equal(tunnel.activePipes.size, 0);
  } finally {
    clearPortForwardTunnels();
  }
});

test("an invalid SOCKS client is removed before opening an SSH channel", async () => {
  const conn = new EventEmitter();
  conn.end = () => {};
  conn.destroy = () => {};
  const tunnel = {
    tunnelId: "pf-socks-invalid-client",
    cancelled: false,
    activePipes: new Set(),
    chainConnections: [],
    sshTransportManaged: false,
  };
  const sender = { id: 3, isDestroyed: () => false };

  try {
    const started = await bindPortForwardChannels({
      type: "dynamic",
      conn,
      tunnelId: tunnel.tunnelId,
      tunnelState: tunnel,
      sender,
      bindAddress: "127.0.0.1",
      localPort: 0,
      remoteHost: "127.0.0.1",
      remotePort: 22,
      chainConnections: [],
      sendStatus() {},
    });
    assert.equal(started.success, true);

    const client = net.connect(tunnel.server.address().port, "127.0.0.1");
    await once(client, "connect");
    client.write(Buffer.from([0x04, 0x01, 0x00]));
    await once(client, "close");
    assert.equal(tunnel.activePipes.size, 0);
    assert.equal(tunnel.server.listening, true);
  } finally {
    await new Promise((resolve, reject) => tunnel.server.close((error) => error ? reject(error) : resolve()));
    clearPortForwardTunnels();
  }
});

test("a late forwardOut stream after stop is rejected and destroyed", () => {
  const tunnel = { cancelled: false, activePipes: new Set() };
  const socket = fakeEndpoint();
  const entry = trackTunnelPipe(tunnel, socket);
  tunnel.cancelled = true;
  const stream = fakeEndpoint();

  assert.equal(attachTunnelPipeStream(tunnel, entry, stream), false);
  assert.equal(socket.destroyedByTest, true);
  assert.equal(stream.destroyedByTest, true);
  assert.equal(tunnel.activePipes.size, 0);
});

test("closing either side tears down the paired endpoint and releases tracking", () => {
  const tunnel = { cancelled: false, activePipes: new Set() };
  const socket = fakeEndpoint();
  const stream = fakeEndpoint();
  const entry = trackTunnelPipe(tunnel, socket);
  assert.equal(attachTunnelPipeStream(tunnel, entry, stream), true);

  socket.emit("close");
  assert.equal(stream.destroyedByTest, true);
  assert.equal(tunnel.activePipes.size, 0);
});
