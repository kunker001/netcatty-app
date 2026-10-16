"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { PluginRpcError, PluginRpcRouter, RPC_ERRORS } = require("./rpcRouter.cjs");
const { PLUGIN_RPC_MAX_JSON_BYTES } = require("./constants.cjs");

function createRouter(options = {}) {
  const sent = [];
  const transfers = [];
  const protocolErrors = [];
  const router = new PluginRpcRouter({
    pluginId: "com.example.test",
    send(message, transfer = []) {
      options.send?.(message, transfer);
      sent.push(message);
      transfers.push(transfer);
    },
    handlers: options.handlers,
    requestHandlers: options.requestHandlers,
    notificationHandlers: options.notificationHandlers,
    maxPending: options.maxPending,
    defaultTimeoutMs: options.defaultTimeoutMs ?? 100,
    onBeforeMessage: options.onBeforeMessage,
    onIncomingStream: options.onIncomingStream,
    onProtocolError(error) { protocolErrors.push(error); },
  });
  return { router, sent, transfers, protocolErrors };
}

test("raw message guards run before schema work and can contain every transport message class", async () => {
  const messages = [
    { malformed: true },
    { jsonrpc: "2.0", id: 1, method: "storage.get", params: { key: "x" } },
    { jsonrpc: "2.0", method: "log.write", params: {} },
    { jsonrpc: "2.0", id: 2, result: null },
    { jsonrpc: "2.0", method: "$/progress", params: { token: "x", value: null } },
    { jsonrpc: "2.0", method: "$/cancelRequest", params: { cancellationId: "x" } },
    { frame: { streamId: "x", sequence: 0, kind: "open", windowBytes: 1 } },
  ];
  for (const guarded of messages) {
    let seen;
    const fixture = createRouter({
      onBeforeMessage(message) {
        seen = message;
        throw new PluginRpcError(RPC_ERRORS.resourceExhausted, "runtime message quota exceeded");
      },
    });

    await fixture.router.accept(guarded);
    assert.equal(seen, guarded);
    assert.equal(fixture.router.closed, true);
    assert.equal(fixture.protocolErrors[0].code, RPC_ERRORS.resourceExhausted);
  }
});

test("raw message guards must remain synchronous", async () => {
  const fixture = createRouter({ onBeforeMessage: async () => true });
  await fixture.router.accept({ jsonrpc: "2.0", method: "log.write", params: {} });
  assert.equal(fixture.router.closed, true);
  assert.match(fixture.protocolErrors[0].message, /must be synchronous/);
});

test("RPC correlation validates initialize results against the reserved contract", async () => {
  const fixture = createRouter();
  const resultPromise = fixture.router.request("plugin.initialize", {
    netcattyVersion: "1.0.0",
    apiVersion: "0.1.0-internal",
    supportedFeatures: [],
  });
  const request = fixture.sent[0];
  await fixture.router.accept({
    jsonrpc: "2.0",
    id: request.id,
    result: {
      pluginId: "com.example.test",
      pluginVersion: "1.0.0",
      apiVersion: "0.1.0-internal",
      enabledFeatures: [],
    },
  });
  assert.equal((await resultPromise).pluginId, "com.example.test");

  const invalidPromise = fixture.router.request("plugin.initialize", {
    netcattyVersion: "1.0.0",
    apiVersion: "0.1.0-internal",
    supportedFeatures: [],
  });
  await fixture.router.accept({ jsonrpc: "2.0", id: fixture.sent.at(-1).id, result: {} });
  await assert.rejects(invalidPromise, /Initialize result violates/);
});

test("RPC deadline sends cancellation and rejects without leaking pending state", async () => {
  const fixture = createRouter({ defaultTimeoutMs: 10 });
  const request = fixture.router.request("plugin.activate", {});
  await assert.rejects(request, (error) => error instanceof PluginRpcError && error.code === RPC_ERRORS.deadlineExceeded);
  assert.equal(fixture.sent.at(-1).method, "$/cancelRequest");
  assert.equal(fixture.router.pending.size, 0);
});

test("one late response after cancellation is ignored without hiding duplicates", async () => {
  const fixture = createRouter({ defaultTimeoutMs: 10 });
  const request = fixture.router.request("provider.invoke", {});
  const requestId = fixture.sent[0].id;
  await assert.rejects(request, (error) => error?.code === RPC_ERRORS.deadlineExceeded);

  await fixture.router.accept({ jsonrpc: "2.0", id: requestId, result: { late: true } });
  assert.equal(fixture.router.closed, false);
  await fixture.router.accept({ jsonrpc: "2.0", id: requestId, result: { duplicate: true } });
  assert.equal(fixture.router.closed, true);
  assert.equal(fixture.protocolErrors.length, 1);
});

test("retired response IDs are not reused for new requests", async () => {
  const fixture = createRouter({ defaultTimeoutMs: 10 });
  fixture.router.nextId = Number.MAX_SAFE_INTEGER;
  const expired = fixture.router.request("provider.expired", {});
  assert.equal(fixture.sent[0].id, Number.MAX_SAFE_INTEGER);
  await assert.rejects(expired);
  fixture.router.nextId = Number.MAX_SAFE_INTEGER;
  const next = fixture.router.request("provider.next", {});
  assert.equal(fixture.sent.at(-1).id, 0);
  fixture.router.close();
  await assert.rejects(next);
});

test("incoming request deadlines do not block later requests", async () => {
  const fixture = createRouter({
    defaultTimeoutMs: 20,
    handlers: {
      "storage.get": async () => new Promise(() => {}),
      "storage.keys": async () => ({ keys: ["ready"] }),
    },
  });
  await fixture.router.accept({
    jsonrpc: "2.0",
    id: "slow",
    method: "storage.get",
    params: { key: "blocked" },
    deadlineMs: 10,
  });
  assert.equal(fixture.sent[0].error.code, RPC_ERRORS.deadlineExceeded);
  await fixture.router.accept({
    jsonrpc: "2.0",
    id: "next",
    method: "storage.keys",
    params: {},
  });
  assert.deepEqual(fixture.sent[1].result, { keys: ["ready"] });
});

test("a stalled stream consumer does not block frames for another stream", async () => {
  let releaseSlowChunk;
  const slowChunk = new Promise((resolve) => { releaseSlowChunk = resolve; });
  const fixture = createRouter({
    onIncomingStream({ streamId, bind }) {
      bind({
        async onChunk(_chunk, release) {
          if (streamId === "slow") await slowChunk;
          release();
        },
      });
      return true;
    },
  });
  const contract = await import("@netcatty/plugin-contract");
  await fixture.router.accept({
    frame: { streamId: "slow", sequence: 0, kind: "open", windowBytes: 1024 },
  });
  const pendingSlowChunk = fixture.router.accept({
    frame: {
      streamId: "slow",
      sequence: 1,
      kind: "chunk",
      data: contract.createJsonStreamChunk({ value: "slow" }),
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  await fixture.router.accept({
    frame: { streamId: "independent", sequence: 0, kind: "open", windowBytes: 1024 },
  });
  assert.equal(fixture.router.streams.incoming.has("independent"), true);

  releaseSlowChunk();
  await pendingSlowChunk;
});

test("incoming handlers can await a nested outgoing RPC response", async () => {
  let fixture;
  fixture = createRouter({
    handlers: {
      "storage.get": async () => fixture.router.request("plugin.nested", {}),
    },
  });
  const incoming = fixture.router.accept({
    jsonrpc: "2.0",
    id: "incoming",
    method: "storage.get",
    params: { key: "value" },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const nested = fixture.sent[0];
  assert.equal(nested.method, "plugin.nested");
  await fixture.router.accept({ jsonrpc: "2.0", id: nested.id, result: { value: 42 } });
  await incoming;
  assert.deepEqual(fixture.sent[1], {
    jsonrpc: "2.0",
    id: "incoming",
    result: { value: 42 },
  });
});

test("an already-aborted outgoing request is never sent", async () => {
  const fixture = createRouter();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fixture.router.request("plugin.activate", {}, { signal: controller.signal }),
    (error) => error?.code === RPC_ERRORS.cancelled,
  );
  assert.deepEqual(fixture.sent, []);
});

test("synchronous transport failure releases RPC correlation and cancellation ownership", async () => {
  const fixture = createRouter({ send() { throw new Error("port is closed"); } });
  await assert.rejects(fixture.router.request("plugin.activate", {}), /port is closed/);
  assert.equal(fixture.router.pending.size, 0);
  assert.equal(fixture.router.pendingCancellationIds.size, 0);
});

test("outgoing cancellation IDs cannot alias concurrent requests", async () => {
  const fixture = createRouter();
  const first = fixture.router.request("plugin.activate", {}, { cancellationId: "same" });
  await assert.rejects(
    fixture.router.request("plugin.deactivate", {}, { cancellationId: "same" }),
    (error) => error?.code === RPC_ERRORS.invalidParams,
  );
  fixture.router.close();
  await assert.rejects(first, (error) => error?.code === RPC_ERRORS.unavailable);
});

test("duplicate in-flight request and cancellation IDs fail without replacing ownership", async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const fixture = createRouter({
    handlers: { "storage.keys": async () => blocked },
  });
  const first = fixture.router.accept({
    jsonrpc: "2.0",
    id: "same-id",
    method: "storage.keys",
    params: {},
    cancellationId: "same-cancel",
  });
  await new Promise((resolve) => setImmediate(resolve));
  await fixture.router.accept({
    jsonrpc: "2.0",
    id: "same-id",
    method: "storage.keys",
    params: {},
    cancellationId: "different-cancel",
  });
  await fixture.router.accept({
    jsonrpc: "2.0",
    id: "different-id",
    method: "storage.keys",
    params: {},
    cancellationId: "same-cancel",
  });
  assert.deepEqual(fixture.sent.map((message) => message.error?.code), [
    RPC_ERRORS.invalidParams,
    RPC_ERRORS.invalidParams,
  ]);
  release({ keys: [] });
  await first;
  assert.deepEqual(fixture.sent.at(-1), {
    jsonrpc: "2.0",
    id: "same-id",
    result: { keys: [] },
  });
  assert.equal(fixture.router.closed, false);
});

test("invalid host handler results become bounded internal errors", async () => {
  const fixture = createRouter({
    handlers: { "storage.keys": async () => ({ unsafe: 1n }) },
  });
  await fixture.router.accept({
    jsonrpc: "2.0",
    id: "invalid-result",
    method: "storage.keys",
    params: {},
  });
  assert.equal(fixture.sent[0].error.code, RPC_ERRORS.internal);
  assert.equal(fixture.router.closed, false);
});

test("incoming requests retain host-assigned plugin identity and unsupported methods fail immediately", async () => {
  const identities = [];
  const fixture = createRouter({
    handlers: {
      "storage.keys": async (_params, context) => {
        identities.push(context.pluginId);
        return { keys: [] };
      },
    },
  });
  await fixture.router.accept({ jsonrpc: "2.0", id: "one", method: "storage.keys", params: {} });
  assert.deepEqual(identities, ["com.example.test"]);
  assert.deepEqual(fixture.sent[0], { jsonrpc: "2.0", id: "one", result: { keys: [] } });

  await fixture.router.accept({ jsonrpc: "2.0", id: "two", method: "host.unsupported", params: {} });
  assert.equal(fixture.sent[1].error.code, RPC_ERRORS.methodNotFound);
});

test("request and notification handler ownership cannot be confused", async () => {
  const calls = [];
  const fixture = createRouter({
    requestHandlers: { "storage.set": async () => { calls.push("request"); return null; } },
    notificationHandlers: { "log.write": async () => { calls.push("notification"); } },
  });
  await fixture.router.accept({ jsonrpc: "2.0", method: "storage.set", params: { key: "x", value: 1 } });
  await fixture.router.accept({ jsonrpc: "2.0", id: "log", method: "log.write", params: {} });
  assert.deepEqual(calls, []);
  assert.equal(fixture.sent[0].error.code, RPC_ERRORS.methodNotFound);
  await fixture.router.accept({ jsonrpc: "2.0", id: "write", method: "storage.set", params: {} });
  await fixture.router.accept({ jsonrpc: "2.0", method: "log.write", params: {} });
  assert.deepEqual(calls, ["request", "notification"]);
});

test("closing the router aborts in-flight notification handlers", async () => {
  let observedSignal;
  const fixture = createRouter({
    notificationHandlers: {
      "events.consume": async (_params, context) => {
        observedSignal = context.signal;
        await new Promise((resolve, reject) => {
          context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
        });
      },
    },
  });
  const accepting = fixture.router.accept({
    jsonrpc: "2.0",
    method: "events.consume",
    params: {},
  });
  await new Promise((resolve) => setImmediate(resolve));
  fixture.router.close();
  await accepting;
  assert.equal(observedSignal.aborted, true);
  assert.equal(fixture.router.inflightNotifications.size, 0);
});

test("outgoing requests validate method-specific plugin results before resolving", async () => {
  const fixture = createRouter();
  const response = fixture.router.request("provider.invoke", {}, {
    validateResult(result) {
      if (result?.status !== "ok") throw new TypeError("Invalid provider result");
      return Object.freeze({ ...result });
    },
  });
  await fixture.router.accept({
    jsonrpc: "2.0",
    id: fixture.sent[0].id,
    result: { status: "failed" },
  });
  await assert.rejects(response, /Invalid provider result/);
  await assert.rejects(
    fixture.router.request("provider.invoke", {}, { validateResult: true }),
    /validator must be a function/,
  );
});

test("outgoing requests keep transferable setup under router correlation and validation", async () => {
  const fixture = createRouter();
  const port = { postMessage() {} };
  const response = fixture.router.request("plugin.terminal.interceptor.attach", {
    descriptor: {
      providerId: "com.example.input",
      direction: "input",
      session: { sessionId: "session-1", protocol: "ssh", status: "connected" },
    },
  }, {
    transfer: [port],
    validateResult(result) {
      if (result?.accepted !== true) throw new TypeError("Invalid attachment result");
      return undefined;
    },
  });
  assert.deepEqual(fixture.transfers[0], [port]);
  await fixture.router.accept({
    jsonrpc: "2.0",
    id: fixture.sent[0].id,
    result: { accepted: true },
  });
  assert.equal(await response, undefined);
  await assert.rejects(
    fixture.router.request("plugin.terminal.interceptor.attach", {}, { transfer: port }),
    /transfer list must be an array/,
  );
});

test("malformed RPC closes the peer instead of accepting a near-match", async () => {
  const fixture = createRouter();
  await fixture.router.accept({ jsonrpc: "2.0", id: -1, method: "plugin.activate" });
  assert.equal(fixture.protocolErrors.length, 1);
  assert.equal(fixture.router.closed, true);
});

test("oversized control messages close the peer before dispatch", async () => {
  let calls = 0;
  const fixture = createRouter({
    handlers: { "storage.set": () => { calls += 1; } },
  });
  await fixture.router.accept({
    jsonrpc: "2.0",
    id: "oversized",
    method: "storage.set",
    params: { key: "value", value: "x".repeat(PLUGIN_RPC_MAX_JSON_BYTES) },
  });
  assert.equal(calls, 0);
  assert.equal(fixture.router.closed, true);
  assert.match(fixture.protocolErrors[0].message, /exceeds/);
});
