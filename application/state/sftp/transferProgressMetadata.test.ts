import assert from "node:assert/strict";
import test from "node:test";

import {
  hasNewSourceFingerprint,
  resolveDurableCheckpointBytes,
  shouldApplyTransferProgress,
} from "./transferProgressMetadata";

test("source fingerprint metadata changes bypass ordinary progress throttling", () => {
  assert.equal(hasNewSourceFingerprint("sha256:old", "sha256:new"), true);
  assert.equal(hasNewSourceFingerprint("sha256:same", "sha256:same"), false);
  assert.equal(shouldApplyTransferProgress({
    elapsedMs: 10,
    transferred: 20,
    total: 100,
    incomingSourceFingerprint: "sha256:new",
  }), true);
  assert.equal(shouldApplyTransferProgress({
    elapsedMs: 10,
    transferred: 20,
    total: 100,
  }), false);
  // Below the UI floor (400ms) ordinary ticks stay suppressed.
  assert.equal(shouldApplyTransferProgress({
    elapsedMs: 250,
    transferred: 20,
    total: 100,
  }), false);
  assert.equal(shouldApplyTransferProgress({
    elapsedMs: 400,
    transferred: 20,
    total: 100,
  }), true);
  // Completion always paints even inside the throttle window.
  assert.equal(shouldApplyTransferProgress({
    elapsedMs: 10,
    transferred: 100,
    total: 100,
  }), true);
});

test("durable checkpoint prefers contiguous bridge offset over high-water transferred", () => {
  // Soft-drain: transferred=3MB, contiguous hole-free offset still 1MB.
  assert.equal(resolveDurableCheckpointBytes({
    transferred: 3 * 1024 * 1024,
    previousCheckpoint: 512 * 1024,
    incomingCheckpoint: 1024 * 1024,
    status: "pausing",
  }), 1024 * 1024);

  // While paused, missing contiguous field must not advance from high-water.
  assert.equal(resolveDurableCheckpointBytes({
    transferred: 9_000_000,
    previousCheckpoint: 1000,
    status: "paused",
  }), 1000);

  // Active stream without explicit contiguous still uses transferred.
  assert.equal(resolveDurableCheckpointBytes({
    transferred: 500,
    previousCheckpoint: 100,
    status: "transferring",
  }), 500);
});
