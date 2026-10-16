"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const {
  _waitForApplicationSpawnForTests: waitForApplicationSpawn,
} = require("./registerBridges.cjs");

test("application launch acknowledgement rejects an asynchronous spawn failure", async () => {
  const child = new EventEmitter();
  const waiting = waitForApplicationSpawn(child);
  const error = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
  process.nextTick(() => child.emit("error", error));
  await assert.rejects(waiting, { code: "ENOENT" });
  assert.equal(child.listenerCount("spawn"), 0);
});

test("application launch acknowledgement resolves only after spawn", async () => {
  const child = new EventEmitter();
  const waiting = waitForApplicationSpawn(child);
  process.nextTick(() => child.emit("spawn"));
  await waiting;
  assert.equal(child.listenerCount("spawn"), 0);
});

test("macOS launcher acknowledgement rejects a nonzero open command exit", async () => {
  const child = new EventEmitter();
  const waiting = waitForApplicationSpawn(child, true);
  process.nextTick(() => {
    child.emit("spawn");
    child.emit("close", 1);
  });
  await assert.rejects(waiting, /launcher exited with code 1/i);
});
