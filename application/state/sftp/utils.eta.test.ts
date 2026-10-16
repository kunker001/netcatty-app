import assert from "node:assert/strict";
import test from "node:test";

import { estimateTransferEtaSeconds, formatTransferEta } from "./utils";

test("estimateTransferEtaSeconds needs meaningful speed and remaining bytes", () => {
  assert.equal(estimateTransferEtaSeconds(0, 1_000_000), null);
  assert.equal(estimateTransferEtaSeconds(10_000_000, 100), null); // < 1 KB/s
  assert.equal(estimateTransferEtaSeconds(10_000_000, 1_000_000), 10);
});

test("formatTransferEta renders compact units", () => {
  assert.equal(formatTransferEta(null), null);
  assert.equal(formatTransferEta(45), "45s");
  assert.equal(formatTransferEta(125), "2m 5s");
  assert.equal(formatTransferEta(3725), "1h 2m");
});
