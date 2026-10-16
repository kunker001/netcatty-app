import assert from "node:assert/strict";
import test from "node:test";
import {
  _resetSharedPluginRuntimeStatusForTests,
  getSharedPluginRuntimeStatus,
  invalidateSharedPluginRuntimeStatus,
} from "./pluginRuntimeStatusCache";

test("plugin runtime status is fetched once for concurrent terminal consumers", async () => {
  _resetSharedPluginRuntimeStatusForTests();
  let calls = 0;
  const bridge = {
    async getPluginRuntimeStatus() {
      calls += 1;
      await Promise.resolve();
      return { available: true } as NetcattyPluginRuntimeStatus;
    },
  };

  const statuses = await Promise.all(
    Array.from({ length: 20 }, () => getSharedPluginRuntimeStatus(bridge)),
  );
  assert.equal(calls, 1);
  assert.equal(statuses.every((status) => status.available), true);

  invalidateSharedPluginRuntimeStatus(bridge);
  await getSharedPluginRuntimeStatus(bridge);
  assert.equal(calls, 2);
});
