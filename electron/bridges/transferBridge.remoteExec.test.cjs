"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { _execSshCommandCancellableForTests } = require("./transferBridge.cjs");

test("same-host copy can cancel before SSH exec opens and closes a late stream", async () => {
  let callback;
  const sshClient = { exec(_command, next) { callback = next; } };
  const transfer = { cancelled: false, abort: null };
  const result = _execSshCommandCancellableForTests(sshClient, "cp", transfer);
  transfer.cancelled = true;
  transfer.abort();
  await assert.rejects(result, /Transfer cancelled/);

  const stream = new EventEmitter();
  stream.stderr = new EventEmitter();
  let closed = 0;
  stream.close = () => { closed += 1; };
  callback(null, stream);
  assert.ok(closed > 0);
  assert.equal(transfer.abort, null);
});

test("same-host copy rejects output floods and SSH stream errors", async () => {
  {
    const stream = new EventEmitter();
    stream.stderr = new EventEmitter();
    stream.close = () => {};
    stream.destroy = () => {};
    const result = _execSshCommandCancellableForTests(
      { exec(_command, next) { next(null, stream); } },
      "cp",
      { cancelled: false, abort: null },
    );
    stream.stderr.emit("data", Buffer.alloc(64 * 1024 + 1));
    await assert.rejects(result, /output exceeded/);
  }
  {
    const stream = new EventEmitter();
    stream.stderr = new EventEmitter();
    stream.close = () => {};
    stream.destroy = () => {};
    const result = _execSshCommandCancellableForTests(
      { exec(_command, next) { next(null, stream); } },
      "cp",
      { cancelled: false, abort: null },
    );
    stream.emit("error", new Error("copy stream failed"));
    await assert.rejects(result, /copy stream failed/);
  }
});
