"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { SessionTombstones } = require("./sessionTombstones.cjs");

test("closed session tombstones stay bounded across unique session ids", () => {
  const tombstones = new SessionTombstones({ maxEntries: 3, ttlMs: 10_000, now: () => 0 });
  for (let index = 0; index < 10; index += 1) tombstones.add(`session-${index}`);

  assert.equal(tombstones.size, 3);
  assert.equal(tombstones.has("session-0"), false);
  assert.equal(tombstones.has("session-9"), true);
});

test("closed session tombstones reject late events only during the safety window", () => {
  let now = 0;
  const tombstones = new SessionTombstones({ maxEntries: 10, ttlMs: 100, now: () => now });
  tombstones.add("session-1");
  assert.equal(tombstones.has("session-1"), true);

  now = 101;
  assert.equal(tombstones.has("session-1"), false);
  assert.equal(tombstones.size, 0);
});

test("reopening the same session removes its tombstone", () => {
  const tombstones = new SessionTombstones();
  tombstones.add("session-1");
  tombstones.delete("session-1");
  assert.equal(tombstones.has("session-1"), false);
});
