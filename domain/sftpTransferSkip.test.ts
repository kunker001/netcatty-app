import assert from "node:assert/strict";
import test from "node:test";

import {
  isUnchangedTransferCandidate,
  normalizeTransferMtimeSeconds,
} from "./sftpTransferSkip";

test("normalizeTransferMtimeSeconds accepts seconds and milliseconds", () => {
  assert.equal(normalizeTransferMtimeSeconds(1_700_000_000), 1_700_000_000);
  assert.equal(normalizeTransferMtimeSeconds(1_700_000_000_500), 1_700_000_000);
  // Year 2000 in milliseconds must not be treated as epoch seconds.
  assert.equal(normalizeTransferMtimeSeconds(946_684_800_000), 946_684_800);
  assert.equal(normalizeTransferMtimeSeconds(946_684_800), 946_684_800);
  // Adapter-declared units cover early-1970 ms without magnitude cutoffs.
  assert.equal(normalizeTransferMtimeSeconds(2_678_400_000, "ms"), 2_678_400);
  assert.equal(normalizeTransferMtimeSeconds(2_678_400, "s"), 2_678_400);
  assert.equal(normalizeTransferMtimeSeconds(60_000_000_000), 60_000_000);
});

test("isUnchangedTransferCandidate requires matching size and second mtime", () => {
  assert.equal(
    isUnchangedTransferCandidate(
      { size: 10, lastModified: 1_700_000_000_200, mtimeUnit: "ms" },
      { size: 10, lastModified: 1_700_000_000_000, mtimeUnit: "ms" },
    ),
    true,
  );
  assert.equal(
    isUnchangedTransferCandidate(
      { size: 10, lastModified: 946_684_800_123, mtimeUnit: "ms" },
      { size: 10, lastModified: 946_684_800_000, mtimeUnit: "ms" },
    ),
    true,
  );
  assert.equal(
    isUnchangedTransferCandidate(
      { size: 10, lastModified: 2_678_400_000, mtimeUnit: "ms" },
      { size: 10, lastModified: 2_678_400_000, mtimeUnit: "ms" },
    ),
    true,
  );
  assert.equal(
    isUnchangedTransferCandidate(
      { size: 10, lastModified: 1_700_000_000, mtimeUnit: "ms" },
      { size: 11, lastModified: 1_700_000_000, mtimeUnit: "ms" },
    ),
    false,
  );
  assert.equal(
    isUnchangedTransferCandidate(
      { size: 10, lastModified: 1_700_000_000_000, mtimeUnit: "ms" },
      { size: 10, lastModified: 1_700_000_001_000, mtimeUnit: "ms" },
    ),
    false,
  );
  assert.equal(
    isUnchangedTransferCandidate(
      { size: 0, lastModified: 1_700_000_000_000, mtimeUnit: "ms" },
      { size: 0, lastModified: 1_700_000_000_000, mtimeUnit: "ms" },
    ),
    true,
  );
  assert.equal(
    isUnchangedTransferCandidate(
      { size: 10, lastModified: 0, mtimeUnit: "ms" },
      { size: 10, lastModified: 0, mtimeUnit: "ms" },
    ),
    false,
  );
});
