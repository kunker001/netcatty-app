import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelConnectAutomationBatch,
  createConnectAutomationBatch,
  trackConnectAutomationStop,
} from "./connectAutomationBatch.ts";

test("cancel waits for the stop operation registered by the abort listener", async () => {
  const batch = createConnectAutomationBatch();
  let releaseStop: (() => void) | undefined;
  let stopFinished = false;

  batch.controller.signal.addEventListener("abort", () => {
    trackConnectAutomationStop(batch, () => new Promise<void>((resolve) => {
      releaseStop = () => {
        stopFinished = true;
        resolve();
      };
    }));
  }, { once: true });

  const cancelling = cancelConnectAutomationBatch(batch);
  await Promise.resolve();
  assert.equal(stopFinished, false);
  releaseStop?.();
  await cancelling;
  assert.equal(stopFinished, true);
});

test("cancel surfaces a backend stop failure", async () => {
  const batch = createConnectAutomationBatch();
  batch.controller.signal.addEventListener("abort", () => {
    trackConnectAutomationStop(batch, async () => {
      throw new Error("stop failed");
    });
  }, { once: true });

  await assert.rejects(() => cancelConnectAutomationBatch(batch), /stop failed/);
});

test("cancel can retry a stop operation after a transient failure", async () => {
  const batch = createConnectAutomationBatch();
  let attempts = 0;
  trackConnectAutomationStop(batch, async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("temporary stop failure");
  });

  await assert.rejects(
    () => cancelConnectAutomationBatch(batch),
    /temporary stop failure/,
  );
  await cancelConnectAutomationBatch(batch);
  assert.equal(attempts, 2);
});
