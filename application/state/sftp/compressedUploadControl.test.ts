import assert from "node:assert/strict";
import test from "node:test";

import { resumeCompressedUploadSafely } from "./compressedUploadControl.ts";

test("live compressed resume failure stays paused instead of starting a second transfer", async () => {
  const outcome = await resumeCompressedUploadSafely({
    transferId: "compressed-live",
    reconnectRequired: false,
    resume: async () => ({ success: false, reason: "Upload resume is unavailable" }),
  });
  assert.deepEqual(outcome, { kind: "failed", reason: "Upload resume is unavailable" });
});

test("restored compressed task may restart when its old worker no longer exists", async () => {
  const outcome = await resumeCompressedUploadSafely({
    transferId: "compressed-restored",
    reconnectRequired: true,
    resume: async () => ({ success: false, reason: "Compression is not active" }),
  });
  assert.deepEqual(outcome, { kind: "restart", reason: "Compression is not active" });
});

test("successful compressed resume rejoins the existing job", async () => {
  const outcome = await resumeCompressedUploadSafely({
    transferId: "compressed-live",
    reconnectRequired: false,
    resume: async () => ({ success: true }),
  });
  assert.deepEqual(outcome, { kind: "resumed" });
});
