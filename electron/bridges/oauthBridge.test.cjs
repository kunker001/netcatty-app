const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const BRIDGE_PATH = require.resolve("./oauthBridge.cjs");

function loadBridge() {
  // Isolate module state between tests — oauthBridge keeps the bound server
  // and pending promise in module-level closures.
  delete require.cache[BRIDGE_PATH];
  return require("./oauthBridge.cjs");
}

async function freshModule() {
  const bridge = loadBridge();
  const cleanup = async () => {
    try {
      bridge.cancelOAuthCallback();
    } catch {
      // ignore
    }
    // Give the server a beat to actually close before the next test binds
    // the same port.
    await new Promise((r) => setTimeout(r, 20));
  };
  return { bridge, cleanup };
}

function tryBindPort(port) {
  return new Promise((resolve) => {
    const s = http.createServer(() => {});
    s.once("error", () => resolve(null));
    s.once("listening", () => resolve(s));
    s.listen(port, "127.0.0.1");
  });
}

async function closeServer(s) {
  if (!s) return;
  await new Promise((resolve) => s.close(resolve));
}

function fetchCallback(port, query) {
  return new Promise((resolve, reject) => {
    const search = new URLSearchParams(query).toString();
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: `/oauth/callback?${search}`,
        method: "GET",
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

test("prepareOAuthCallback binds and reports port + redirectUri", async () => {
  const { bridge, cleanup } = await freshModule();
  try {
    const { port, redirectUri } = await bridge.prepareOAuthCallback();
    assert.ok(Number.isInteger(port) && port > 0, `got port=${port}`);
    assert.equal(redirectUri, `http://127.0.0.1:${port}/oauth/callback`);
    assert.equal(bridge.getActiveOAuthPort(), port);
  } finally {
    await cleanup();
  }
});

test("prepareOAuthCallback prefers port 45678 when it is free", async () => {
  // Probe: if 45678 is already held by something external, skip this test —
  // the fallback path is exercised in the next test.
  const probe = await tryBindPort(45678);
  if (!probe) {
    return; // treated as pass; environment doesn't permit this assertion
  }
  await closeServer(probe);

  const { bridge, cleanup } = await freshModule();
  try {
    const { port } = await bridge.prepareOAuthCallback();
    assert.equal(port, 45678);
  } finally {
    await cleanup();
  }
});

test("prepareOAuthCallback falls back to an OS-assigned port when 45678 is busy (#823)", async () => {
  // Hold port 45678 ourselves so the bridge MUST fall back.
  const squatter = await tryBindPort(45678);
  if (!squatter) {
    // Something else is already holding 45678 — just ensure the bridge
    // still produces a working port rather than crashing.
    const { bridge, cleanup } = await freshModule();
    try {
      const { port } = await bridge.prepareOAuthCallback();
      assert.ok(port > 0 && port !== 45678);
    } finally {
      await cleanup();
    }
    return;
  }

  const { bridge, cleanup } = await freshModule();
  try {
    const { port, redirectUri } = await bridge.prepareOAuthCallback();
    assert.notEqual(port, 45678, "expected a different port when 45678 is in use");
    assert.ok(port > 0);
    assert.equal(redirectUri, `http://127.0.0.1:${port}/oauth/callback`);
    assert.equal(bridge.getActiveOAuthPort(), port);
  } finally {
    await cleanup();
    await closeServer(squatter);
  }
});

test("awaitOAuthCallback resolves with the code when the browser hits the redirect URI", async () => {
  const { bridge, cleanup } = await freshModule();
  try {
    const { port } = await bridge.prepareOAuthCallback();
    const pending = bridge.awaitOAuthCallback();

    const status = await fetchCallback(port, { code: "test-code", state: "anything" });
    assert.equal(status, 200);

    const result = await pending;
    assert.equal(result.code, "test-code");
  } finally {
    await cleanup();
  }
});

test("awaitOAuthCallback rejects on state mismatch", async () => {
  const { bridge, cleanup } = await freshModule();
  try {
    const { port } = await bridge.prepareOAuthCallback();
    const pending = bridge.awaitOAuthCallback("expected-state");
    // Attach the assertion BEFORE triggering the callback so the rejection
    // is never unhandled.
    const rejectsCheck = assert.rejects(pending, /State mismatch/);

    await fetchCallback(port, { code: "test-code", state: "different-state" });
    await rejectsCheck;
  } finally {
    await cleanup();
  }
});

test("awaitOAuthCallback rejects when the provider returns an error", async () => {
  const { bridge, cleanup } = await freshModule();
  try {
    const { port } = await bridge.prepareOAuthCallback();
    const pending = bridge.awaitOAuthCallback();
    const rejectsCheck = assert.rejects(pending, /access_denied/);

    await fetchCallback(port, { error: "access_denied", error_description: "access_denied" });
    await rejectsCheck;
  } finally {
    await cleanup();
  }
});

test("awaitOAuthCallback errors if called before prepareOAuthCallback", async () => {
  const { bridge, cleanup } = await freshModule();
  try {
    await assert.rejects(bridge.awaitOAuthCallback(), /not prepared/);
  } finally {
    await cleanup();
  }
});

test("cancelOAuthCallback releases the bound port", async () => {
  const { bridge, cleanup } = await freshModule();
  try {
    const { port } = await bridge.prepareOAuthCallback();
    assert.equal(bridge.getActiveOAuthPort(), port);
    bridge.cancelOAuthCallback();
    assert.equal(bridge.getActiveOAuthPort(), null);

    // Give the OS a beat to release the socket, then confirm re-bindable.
    await new Promise((r) => setTimeout(r, 30));
    const rebound = await tryBindPort(port);
    assert.ok(rebound, `expected ${port} to be re-bindable after cancel`);
    await closeServer(rebound);
  } finally {
    await cleanup();
  }
});

test("callbacks that arrive before awaitOAuthCallback do not consume the session", async () => {
  const { bridge, cleanup } = await freshModule();
  try {
    const { port } = await bridge.prepareOAuthCallback();

    const earlyStatus = await fetchCallback(port, { code: "stale-code", state: "stale-state" });
    assert.equal(earlyStatus, 200);
    assert.equal(bridge.getActiveOAuthPort(), port);

    const pending = bridge.awaitOAuthCallback("expected-state");
    const status = await fetchCallback(port, {
      code: "fresh-code",
      state: "expected-state",
    });
    assert.equal(status, 200);

    const result = await pending;
    assert.equal(result.code, "fresh-code");
  } finally {
    await cleanup();
  }
});

test("cancelOAuthCallback before awaitOAuthCallback is replayed as a cancellation", async () => {
  const { bridge, cleanup } = await freshModule();
  try {
    const { sessionId } = await bridge.prepareOAuthCallback();
    bridge.cancelOAuthCallback(sessionId);
    await assert.rejects(bridge.awaitOAuthCallback(undefined, sessionId), /cancelled/);
  } finally {
    await cleanup();
  }
});

test("cancelOAuthCallback during prepare rejects the pending prepare", async () => {
  const { bridge, cleanup } = await freshModule();
  try {
    const pendingPrepare = bridge.prepareOAuthCallback();
    bridge.cancelOAuthCallback();

    await assert.rejects(pendingPrepare, /cancelled/);
    assert.equal(bridge.getActiveOAuthPort(), null);
  } finally {
    await cleanup();
  }
});

test("cancelOAuthCallback ignores stale session ids", async () => {
  const { bridge, cleanup } = await freshModule();
  try {
    const stale = await bridge.prepareOAuthCallback();
    const fresh = await bridge.prepareOAuthCallback();

    bridge.cancelOAuthCallback(stale.sessionId);
    assert.equal(bridge.getActiveOAuthPort(), fresh.port);

    const pending = bridge.awaitOAuthCallback(undefined, fresh.sessionId);
    const status = await fetchCallback(fresh.port, { code: "fresh-code" });
    assert.equal(status, 200);

    const result = await pending;
    assert.equal(result.code, "fresh-code");
  } finally {
    await cleanup();
  }
});

test("awaitOAuthCallback rejects stale session ids instead of attaching to the new flow", async () => {
  const { bridge, cleanup } = await freshModule();
  try {
    const stale = await bridge.prepareOAuthCallback();
    const fresh = await bridge.prepareOAuthCallback();

    await assert.rejects(
      bridge.awaitOAuthCallback(undefined, stale.sessionId),
      /cancelled/
    );

    const pending = bridge.awaitOAuthCallback(undefined, fresh.sessionId);
    const status = await fetchCallback(fresh.port, { code: "fresh-code" });
    assert.equal(status, 200);

    const result = await pending;
    assert.equal(result.code, "fresh-code");
  } finally {
    await cleanup();
  }
});

test("concurrent prepareOAuthCallback calls cancel the superseded attempt", async () => {
  const { bridge, cleanup } = await freshModule();
  try {
    const stalePrepare = bridge.prepareOAuthCallback();
    const staleRejects = assert.rejects(stalePrepare, /cancelled/);

    const freshPrepare = bridge.prepareOAuthCallback();
    const fresh = await freshPrepare;
    await staleRejects;

    const pending = bridge.awaitOAuthCallback(undefined, fresh.sessionId);
    const status = await fetchCallback(fresh.port, { code: "fresh-code" });
    assert.equal(status, 200);

    const result = await pending;
    assert.equal(result.code, "fresh-code");
  } finally {
    await cleanup();
  }
});

test("prepareOAuthCallback replaces an in-flight await cleanly", async () => {
  const { bridge, cleanup } = await freshModule();
  try {
    const stale = await bridge.prepareOAuthCallback();
    const stalePending = bridge.awaitOAuthCallback(undefined, stale.sessionId);
    const staleRejects = assert.rejects(stalePending, /cancelled/);

    const fresh = await bridge.prepareOAuthCallback();
    await staleRejects;

    const nextPending = bridge.awaitOAuthCallback(undefined, fresh.sessionId);
    const status = await fetchCallback(fresh.port, { code: "fresh-code" });
    assert.equal(status, 200);

    const result = await nextPending;
    assert.equal(result.code, "fresh-code");
  } finally {
    await cleanup();
  }
});

test("getActiveOAuthPort is null before prepare and after cleanup", async () => {
  const { bridge, cleanup } = await freshModule();
  try {
    assert.equal(bridge.getActiveOAuthPort(), null);
    await bridge.prepareOAuthCallback();
    assert.notEqual(bridge.getActiveOAuthPort(), null);
  } finally {
    await cleanup();
  }
  assert.equal(require("./oauthBridge.cjs").getActiveOAuthPort(), null);
});
