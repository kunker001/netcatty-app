"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  registerPluginShutdown,
  resetPluginShutdownForTests,
  runPluginShutdown,
} = require("./shutdownCoordinator.cjs");

test("plugin shutdown is idempotent and completes before its quit deadline", async (context) => {
  context.after(resetPluginShutdownForTests);
  let calls = 0;
  registerPluginShutdown(async () => { calls += 1; });
  const [first, second] = await Promise.all([runPluginShutdown(), runPluginShutdown()]);
  assert.deepEqual(first, { timedOut: false });
  assert.deepEqual(second, { timedOut: false });
  assert.equal(calls, 1);
});

test("plugin shutdown fails open after the bounded quit deadline", async (context) => {
  context.after(resetPluginShutdownForTests);
  registerPluginShutdown(async () => new Promise(() => {}));
  assert.deepEqual(await runPluginShutdown({ timeoutMs: 5 }), { timedOut: true });
});

test("app shutdown waits for every registered cleanup handler", async (context) => {
  context.after(resetPluginShutdownForTests);
  const calls = [];
  let releasePortForwardCleanup;
  const portForwardCleanup = new Promise((resolve) => { releasePortForwardCleanup = resolve; });
  registerPluginShutdown(async () => { calls.push("plugins"); });
  registerPluginShutdown(async () => {
    await portForwardCleanup;
    calls.push("port-forwards");
  });

  let settled = false;
  const shutdown = runPluginShutdown({ timeoutMs: 1_000 }).then((result) => {
    settled = true;
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(calls, ["plugins"]);

  releasePortForwardCleanup();
  assert.deepEqual(await shutdown, { timedOut: false });
  assert.deepEqual(calls, ["plugins", "port-forwards"]);
});

test("one failed cleanup does not let app shutdown abandon other handlers", async (context) => {
  context.after(resetPluginShutdownForTests);
  let releaseRemainingCleanup;
  const remainingCleanup = new Promise((resolve) => { releaseRemainingCleanup = resolve; });
  registerPluginShutdown(async () => { throw new Error("plugin cleanup failed"); });
  registerPluginShutdown(async () => remainingCleanup);

  let settled = false;
  const shutdown = runPluginShutdown({ timeoutMs: 1_000 }).finally(() => {
    settled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "failure must not abandon another live cleanup");

  releaseRemainingCleanup();
  await assert.rejects(shutdown, /plugin cleanup failed/);
});
