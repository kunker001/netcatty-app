"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

async function createPair() {
  const { createPluginStreamEndpoint } = await import("./runtime/pluginStreamEndpoint.mjs");
  let left;
  let right;
  const leftTransport = {
    post(message) { queueMicrotask(() => right.accept(message)); },
  };
  const rightTransport = {
    post(message) { queueMicrotask(() => left.accept(message)); },
  };
  left = createPluginStreamEndpoint(leftTransport);
  right = createPluginStreamEndpoint(rightTransport);
  return { left, right };
}

test("runtime byte streams transfer owned chunks and end normally", async () => {
  const { left, right } = await createPair();
  const readablePromise = right.acceptReadable("connection:output");
  const writable = await left.openWritable("connection:output", 1024);
  const readable = await readablePromise;

  await writable.write(Uint8Array.from([1, 2, 3]));
  assert.deepEqual([...await readable.read()], [1, 2, 3]);
  const ended = writable.end();
  assert.equal(await readable.read(), null);
  await ended;
});

test("runtime byte streams retain receive credit until the next read", async () => {
  const { left, right } = await createPair();
  const readablePromise = right.acceptReadable("import:records");
  const writable = await left.openWritable("import:records", 1024);
  const readable = await readablePromise;
  const first = new Uint8Array(1024);
  await writable.write(first);
  assert.equal((await readable.read()).byteLength, 1024);

  let secondSettled = false;
  const second = writable.write(Uint8Array.of(9)).then(() => { secondSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(secondSettled, false);
  assert.deepEqual([...await readable.read()], [9]);
  await second;
});

test("runtime byte stream cancellation rejects queued writes", async () => {
  const { left, right } = await createPair();
  const readablePromise = right.acceptReadable("connection:input");
  const writable = await left.openWritable("connection:input", 1024);
  const readable = await readablePromise;
  await writable.write(new Uint8Array(1024));
  const blocked = writable.write(Uint8Array.of(1));
  readable.cancel();
  await assert.rejects(blocked, /cancel/i);
});

test("runtime byte streams reject invalid identifiers and windows", async () => {
  const { left } = await createPair();
  await assert.rejects(left.openWritable("", 1024), /stream ID/i);
  await assert.rejects(left.openWritable("valid", 1), /window/i);
});

test("runtime byte stream end waits behind backpressure and preserves ordering", async () => {
  const { left, right } = await createPair();
  const readablePromise = right.acceptReadable("ordered-end");
  const writable = await left.openWritable("ordered-end", 1024);
  const readable = await readablePromise;
  await writable.write(new Uint8Array(1024));
  const blocked = writable.write(Uint8Array.of(7));
  const ending = writable.end();
  assert.equal((await readable.read()).byteLength, 1024);
  assert.deepEqual([...await readable.read()], [7]);
  await blocked;
  assert.equal(await readable.read(), null);
  await ending;
});

test("runtime byte streams reject concurrent reads and bound pending accept reservations", async () => {
  const { left, right } = await createPair();
  const readablePromise = right.acceptReadable("serial-read");
  await left.openWritable("serial-read", 1024);
  const readable = await readablePromise;
  const pendingRead = readable.read();
  await assert.rejects(readable.read(), /concurrent reads/i);
  readable.cancel();
  await assert.rejects(pendingRead, /cancel/i);

  const firstRead = left.acceptReadable("read-once");
  await assert.rejects(left.acceptReadable("read-once"), /cannot be accepted/i);
  left.rejectReadable("read-once");
  await assert.rejects(firstRead, /cancel/i);

  const { createPluginStreamEndpoint } = await import("./runtime/pluginStreamEndpoint.mjs");
  const endpoint = createPluginStreamEndpoint({ post() {} }, { maxStreams: 1 });
  const reserved = endpoint.acceptReadable("reserved");
  await assert.rejects(endpoint.acceptReadable("overflow"), /limit/i);
  endpoint.rejectReadable("reserved");
  await assert.rejects(reserved, /cancel/i);
});
