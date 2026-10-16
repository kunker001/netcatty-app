"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PLUGIN_JSON_MAX_DEPTH,
  PLUGIN_JSON_MAX_NODES,
  assertPluginJsonValue,
} = require("./jsonBoundary.cjs");

test("main-process JSON boundary matches the public contract budgets", async () => {
  const contract = await import("@netcatty/plugin-contract");
  const hostLimits = require("./constants.cjs");
  assert.equal(PLUGIN_JSON_MAX_DEPTH, contract.PLUGIN_JSON_MAX_DEPTH);
  assert.equal(PLUGIN_JSON_MAX_NODES, contract.PLUGIN_JSON_MAX_NODES);
  assert.equal(hostLimits.PLUGIN_RPC_MAX_JSON_BYTES, contract.PLUGIN_RPC_MAX_JSON_BYTES);
  assert.equal(
    hostLimits.PLUGIN_STREAM_MAX_FRAME_JSON_BYTES,
    contract.PLUGIN_STREAM_MAX_FRAME_JSON_BYTES,
  );
});

test("main-process JSON boundary rejects deep, sparse, cyclic, and accessor values", () => {
  let deep = null;
  for (let index = 0; index <= PLUGIN_JSON_MAX_DEPTH; index += 1) deep = [deep];
  assert.throws(() => assertPluginJsonValue(deep), /levels/);
  const sparse = [];
  sparse.length = 1;
  assert.throws(() => assertPluginJsonValue(sparse), /dense/);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => assertPluginJsonValue(cyclic), /cycles/);
  const accessor = {};
  Object.defineProperty(accessor, "value", { get: () => 1, enumerable: true });
  assert.throws(() => assertPluginJsonValue(accessor), /data properties/);
});

test("main-process JSON boundary enforces an incremental UTF-8 byte budget", () => {
  const value = { text: "你好\n\"", empty: [] };
  const exactBytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  assert.deepEqual(assertPluginJsonValue(value, { maxBytes: exactBytes }), value);
  assert.throws(
    () => assertPluginJsonValue(value, { maxBytes: exactBytes - 1 }),
    new RegExp(`exceeds ${exactBytes - 1} bytes`),
  );
  assert.throws(() => assertPluginJsonValue({}, { maxBytes: 0 }), /positive safe integer/);
});

test("maximum broker raw payloads fit inside JSON-RPC envelopes", () => {
  const { PLUGIN_RPC_MAX_RAW_BYTES, PLUGIN_RPC_MAX_JSON_BYTES } = require("./constants.cjs");
  const { assertRpcMessage } = require("./contractValidator.cjs");
  const data = Buffer.alloc(PLUGIN_RPC_MAX_RAW_BYTES).toString("base64");
  const response = {
    jsonrpc: "2.0",
    id: 1,
    result: {
      url: `https://example.com/${"x".repeat(8_000)}`,
      status: 200,
      headers: { "x-budget": "y".repeat(64 * 1024) },
      body: { encoding: "base64", data },
    },
  };
  assert.ok(Buffer.byteLength(JSON.stringify(response)) < PLUGIN_RPC_MAX_JSON_BYTES);
  assert.doesNotThrow(() => assertRpcMessage(response));
  const request = {
    jsonrpc: "2.0",
    id: 2,
    method: "network.request",
    params: {
      url: `https://example.com/${"x".repeat(8_000)}`,
      headers: Object.fromEntries(Array.from({ length: 8 }, (_, index) => (
        [`x-budget-${index}`, "\\".repeat(8 * 1024)]
      ))),
      body: { encoding: "utf8", data: "\0".repeat(PLUGIN_RPC_MAX_RAW_BYTES) },
    },
  };
  assert.ok(Buffer.byteLength(JSON.stringify(request)) < PLUGIN_RPC_MAX_JSON_BYTES);
  assert.doesNotThrow(() => assertRpcMessage(request));
});
