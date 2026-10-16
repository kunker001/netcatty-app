import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("directory parent progress freezes while pausing without re-pausing child streams", () => {
  const source = readFileSync(new URL("./transferDirectoryOps.ts", import.meta.url), "utf8");
  assert.match(source, /const parentFrozen = !!parentRow/);
  assert.match(source, /parentRow\.status === "paused"/);
  assert.match(source, /parentRow\.status === "pausing"/);
  assert.match(source, /\|\| isPauseLatched\(rootTaskId\)/);
  assert.match(source, /if \(parentFrozen\) \{\s*return \{ \.\.\.t, speed: 0 \};/);
  assert.doesNotMatch(source, /const pauseRequested = .*status === "paused"/);
});

test("directory pauseWatch undoes pause when control epoch is superseded", () => {
  const source = readFileSync(new URL("./transferDirectoryOps.ts", import.meta.url), "utf8");
  assert.match(source, /epochAtAttempt/);
  assert.match(source, /isTransferControlEpochCurrent\(rootTaskId, epochAtAttempt\)/);
  assert.match(source, /resumeTransfer\?\.\(task\.id\)/);
});

test("store soft-fail demotes and held rejoin uses bridge lifecycleEpoch (source contract)", () => {
  const source = readFileSync(new URL("../sftpTransferCenterStore.ts", import.meta.url), "utf8");
  // Soft-fail must demote before silent return
  assert.match(source, /softFailedNeedsHard|Transfer session is no longer active/);
  assert.match(source, /controller = undefined/);
  // Held soft-rejoin must not stamp control-plane epoch onto task.lifecycleEpoch
  assert.doesNotMatch(source, /lifecycleEpoch: heldResumeEpoch/);
  assert.match(source, /Prefer bridge lifecycleEpoch|bridgeEpoch/);
});

test("directory childTask clears inherited lifecycleEpoch before stream arm", () => {
  const source = readFileSync(new URL("./transferDirectoryOps.ts", import.meta.url), "utf8");
  assert.match(source, /lifecycleEpoch: undefined/);
  assert.match(source, /Never\s+inherit the parent's soft-resume epoch|New\/restarted child streams arm at bridge lifecycleEpoch 0/i);
});

test("softResume does not stamp parent resume epoch onto non-resumed siblings", () => {
  const source = readFileSync(new URL("./globalSftpTransferControl.ts", import.meta.url), "utf8");
  assert.match(source, /Non-resumed siblings under the folder/);
  assert.match(source, /lifecycleEpoch: undefined/);
  assert.match(source, /bridgeEpochById/);
});
