import { test } from "node:test";
import assert from "node:assert/strict";
import { captureInheritedCwd } from "./inheritedCwd";

const neverProbe = async () => { throw new Error("should not probe"); };

test("live tracked cwd wins over everything and skips the probe", async () => {
  const cwd = await captureInheritedCwd(
    { id: "s", protocol: "ssh", status: "connected", lastCwd: "/stale" },
    neverProbe,
    { liveCwd: "/live/tracked" },
  );
  assert.equal(cwd, "/live/tracked");
});

test("connected ssh probes live cwd when no tracked cwd, ignoring stale lastCwd", async () => {
  const cwd = await captureInheritedCwd(
    { id: "s", protocol: "ssh", status: "connected", lastCwd: "/stale" },
    async () => ({ success: true, cwd: "/probed" }),
  );
  assert.equal(cwd, "/probed");
});

test("connected ssh does NOT probe when allowSshProbe is false (network device)", async () => {
  const cwd = await captureInheritedCwd(
    { id: "s", protocol: "ssh", status: "connected", lastCwd: "/a" },
    neverProbe,
    { allowSshProbe: false },
  );
  assert.equal(cwd, "/a");
});

test("connected ssh falls back to lastCwd when probe reports failure", async () => {
  const cwd = await captureInheritedCwd(
    { id: "s", protocol: "ssh", status: "connected", lastCwd: "/a" },
    async () => ({ success: false }),
  );
  assert.equal(cwd, "/a");
});

test("connected ssh falls back to lastCwd when probe throws", async () => {
  const cwd = await captureInheritedCwd(
    { id: "s", protocol: "ssh", status: "connected", lastCwd: "/a" },
    async () => { throw new Error("boom"); },
  );
  assert.equal(cwd, "/a");
});

test("connected ssh with no lastCwd and failed probe -> undefined", async () => {
  const cwd = await captureInheritedCwd(
    { id: "s", protocol: "ssh", status: "connected" },
    async () => ({ success: false }),
  );
  assert.equal(cwd, undefined);
});

test("connected ssh falls back to lastCwd when probe exceeds the timeout", async () => {
  const cwd = await captureInheritedCwd(
    { id: "s", protocol: "ssh", status: "connected", lastCwd: "/a" },
    () => new Promise(() => { /* never resolves */ }),
    { probeTimeoutMs: 10 },
  );
  assert.equal(cwd, "/a");
});

test("connected ssh passes its probe timeout to the backend", async () => {
  let receivedOptions: { allowHomeFallback?: boolean; timeoutMs?: number } | undefined;
  await captureInheritedCwd(
    { id: "s", protocol: "ssh", status: "connected" },
    async (_sessionId, options) => {
      receivedOptions = options;
      return { success: false };
    },
    { probeTimeoutMs: 1234 },
  );
  assert.deepEqual(receivedOptions, { allowHomeFallback: false, timeoutMs: 1234 });
});

test("disconnected ssh uses lastCwd without probing", async () => {
  const cwd = await captureInheritedCwd(
    { id: "s", protocol: "ssh", status: "disconnected", lastCwd: "/a" },
    neverProbe,
  );
  assert.equal(cwd, "/a");
});

test("local uses live tracked cwd when present (no probe)", async () => {
  const cwd = await captureInheritedCwd(
    { id: "s", protocol: "local", status: "connected", localStartDir: "/home/u" },
    neverProbe,
    { liveCwd: "/home/u/project" },
  );
  assert.equal(cwd, "/home/u/project");
});

test("local without live cwd or lastCwd falls back to localStartDir (no probe)", async () => {
  const cwd = await captureInheritedCwd(
    { id: "s", protocol: "local", status: "connected", localStartDir: "/home/u" },
    neverProbe,
  );
  assert.equal(cwd, "/home/u");
});
