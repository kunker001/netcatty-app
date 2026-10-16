"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { runInNewContext } = require("node:vm");

const {
  TERMINAL_INTERCEPTOR_MAX_CHUNK_BYTES,
  TERMINAL_INTERCEPTOR_MAX_WINDOW_BYTES,
  createTerminalInterceptorEnvelope,
} = require("./terminalInterceptorTransport.cjs");

test("terminal interceptor envelopes validate canonical ready, chunk, and result frames", () => {
  assert.deepEqual(createTerminalInterceptorEnvelope({
    type: "netcatty:terminal-interceptor:ready",
    sessionId: "session-1",
    direction: "output",
    windowBytes: TERMINAL_INTERCEPTOR_MAX_WINDOW_BYTES,
  }), {
    frame: {
      type: "netcatty:terminal-interceptor:ready",
      sessionId: "session-1",
      direction: "output",
      windowBytes: TERMINAL_INTERCEPTOR_MAX_WINDOW_BYTES,
    },
  });

  const chunkData = new Uint8Array([1, 2, 3]).buffer;
  const chunk = createTerminalInterceptorEnvelope({
    type: "netcatty:terminal-interceptor:chunk",
    sequence: 1,
    direction: "input",
    creditBytes: TERMINAL_INTERCEPTOR_MAX_CHUNK_BYTES,
    byteLength: 3,
  }, chunkData);
  assert.equal(chunk.transfer, chunkData);

  const resultData = runInNewContext("new Uint8Array([4, 5]).buffer");
  const result = createTerminalInterceptorEnvelope({
    type: "netcatty:terminal-interceptor:result",
    sequence: Number.MAX_SAFE_INTEGER,
    status: "ok",
    creditBytes: 3,
    byteLength: 2,
  }, resultData);
  assert.equal(result.transfer, resultData);

  assert.deepEqual(createTerminalInterceptorEnvelope({
    type: "netcatty:terminal-interceptor:result",
    sequence: 2,
    status: "failed",
  }), {
    frame: {
      type: "netcatty:terminal-interceptor:result",
      sequence: 2,
      status: "failed",
    },
  });
});

test("terminal interceptor envelopes fail closed on schema or transfer mismatches", () => {
  const data = new ArrayBuffer(4);
  assert.throws(
    () => createTerminalInterceptorEnvelope({
      type: "netcatty:terminal-interceptor:chunk",
      sequence: 0,
      direction: "input",
      creditBytes: 1,
      byteLength: 4,
    }, data),
    /violates the plugin contract/,
  );
  assert.throws(
    () => createTerminalInterceptorEnvelope({
      type: "netcatty:terminal-interceptor:chunk",
      sequence: 1,
      direction: "input",
      creditBytes: 1,
      byteLength: 3,
    }, data),
    /byteLength mismatch/,
  );
  assert.throws(
    () => createTerminalInterceptorEnvelope({
      type: "netcatty:terminal-interceptor:result",
      sequence: 1,
      status: "ok",
      creditBytes: 4,
      byteLength: 4,
    }),
    /requires a transferred ArrayBuffer/,
  );
  assert.throws(
    () => createTerminalInterceptorEnvelope({
      type: "netcatty:terminal-interceptor:ready",
      sessionId: "session-1",
      direction: "input",
      windowBytes: TERMINAL_INTERCEPTOR_MAX_CHUNK_BYTES,
      extra: true,
    }),
    /violates the plugin contract/,
  );
  assert.throws(
    () => createTerminalInterceptorEnvelope({
      type: "netcatty:terminal-interceptor:result",
      sequence: 1,
      status: "failed",
    }, data),
    /must not include a transferred buffer/,
  );

  const detached = new ArrayBuffer(0);
  structuredClone(detached, { transfer: [detached] });
  assert.throws(
    () => createTerminalInterceptorEnvelope({
      type: "netcatty:terminal-interceptor:chunk",
      sequence: 1,
      direction: "input",
      creditBytes: 1,
      byteLength: 0,
    }, detached),
    /requires a real, attached ArrayBuffer/,
  );
});
