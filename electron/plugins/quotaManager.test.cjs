"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { PluginQuotaManager } = require("./quotaManager.cjs");
const { RPC_ERRORS } = require("./rpcRouter.cjs");

test("transport, capability, log, concurrency, and byte quotas fail closed and refill", async () => {
  let now = 0;
  const manager = new PluginQuotaManager({
    clock: () => now,
    quotas: {
      messageBurst: 2,
      messagesPerSecond: 1,
      concurrentCapabilities: 1,
      capabilityBurst: 2,
      capabilitiesPerMinute: 1,
      logWritesPerMinute: 1,
      bytesPerMinute: 4,
    },
  });
  const identity = { runtimeId: "runtime-1" };
  manager.guardMessage(identity);
  manager.guardMessage(identity);
  assert.throws(() => manager.guardMessage(identity), (error) => error.code === RPC_ERRORS.resourceExhausted);
  now += 1_000;
  manager.guardMessage(identity);

  const middleware = manager.createMiddleware();
  let release;
  const pending = middleware({ runtimeId: "runtime-1", method: "network.request" }, () => (
    new Promise((resolve) => { release = resolve; })
  ));
  await assert.rejects(
    middleware({ runtimeId: "runtime-1", method: "network.request" }, async () => null),
    (error) => error.code === RPC_ERRORS.resourceExhausted,
  );
  release();
  await pending;

  await middleware({ runtimeId: "runtime-log", method: "log.write" }, async () => null);
  await assert.rejects(
    middleware({ runtimeId: "runtime-log", method: "log.write" }, async () => null),
    (error) => error.code === RPC_ERRORS.resourceExhausted,
  );

  manager.chargeBytes("runtime-1", "network", 4);
  assert.throws(
    () => manager.chargeBytes("runtime-1", "network", 1),
    (error) => error.code === RPC_ERRORS.resourceExhausted,
  );
  now += 60_000;
  manager.chargeBytes("runtime-1", "network", 4);
  manager.shutdown();
});

test("runtime process quotas report sustained CPU and memory violations", async () => {
  const samples = [];
  const cleared = [];
  const violations = [];
  let metrics = { memoryBytes: 0, cpuPercent: 90 };
  const manager = new PluginQuotaManager({
    getProcessMetrics: async () => metrics,
    onViolation: async (_identity, error) => violations.push(error.message),
    quotas: { sustainedCpuSamples: 2, cpuPercent: 80, memoryBytes: 100 },
    setInterval: (callback) => { samples.push(callback); return { id: samples.length }; },
    clearInterval: (timer) => cleared.push(timer),
  });
  const runtime = { getProcessId: () => 123 };
  manager.trackRuntime({ runtimeId: "runtime-1" }, runtime);
  await new Promise((resolve) => setImmediate(resolve));
  await samples[0]();
  assert.deepEqual(violations, ["Plugin sustained CPU quota exceeded"]);
  assert.equal(cleared.length, 1);

  metrics = { memoryBytes: 101, cpuPercent: 0 };
  manager.trackRuntime({ runtimeId: "runtime-2" }, runtime);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(violations, [
    "Plugin sustained CPU quota exceeded",
    "Plugin memory quota exceeded",
  ]);
  manager.trackProcess(
    "runtime-3\0companion:one",
    { runtimeId: "runtime-3" },
    runtime,
  );
  manager.releaseRuntime("runtime-3");
  assert.equal(cleared.length, 3, "runtime release disposes companion process monitors");
  manager.shutdown();
});
