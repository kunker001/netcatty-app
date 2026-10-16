import assert from "node:assert/strict";
import test from "node:test";

import { connectHostsStaggered } from "./connectHostsStaggered";

test("connects the first target synchronously and defers the rest", () => {
  const connected: string[] = [];
  const scheduled: Array<{ delay: number; run: () => void }> = [];

  connectHostsStaggered(["a", "b", "c"], (h) => connected.push(h), {
    stepMs: 100,
    schedule: (cb, delay) => {
      scheduled.push({ delay, run: cb });
    },
  });

  // First terminal mounts immediately so a tab appears without waiting.
  assert.deepEqual(connected, ["a"]);
  // The remaining two are deferred, not run on the same frame.
  assert.equal(scheduled.length, 2);
});

test("running the scheduled callbacks connects the rest in order", () => {
  const connected: string[] = [];
  const scheduled: Array<() => void> = [];

  connectHostsStaggered(["a", "b", "c"], (h) => connected.push(h), {
    schedule: (cb) => {
      scheduled.push(cb);
    },
  });

  scheduled.forEach((run) => run());

  assert.deepEqual(connected, ["a", "b", "c"]);
});

test("spreads deferred connects across increasing delays", () => {
  const delays: number[] = [];

  connectHostsStaggered(["a", "b", "c", "d"], () => {}, {
    stepMs: 80,
    schedule: (_cb, delay) => {
      delays.push(delay);
    },
  });

  // index 1..n each scheduled one step further out so no two heavy mounts
  // land on the same frame.
  assert.deepEqual(delays, [80, 160, 240]);
});

test("single target connects synchronously with no scheduling", () => {
  const connected: string[] = [];
  let scheduleCalls = 0;

  connectHostsStaggered(["only"], (h) => connected.push(h), {
    schedule: () => {
      scheduleCalls += 1;
    },
  });

  assert.deepEqual(connected, ["only"]);
  assert.equal(scheduleCalls, 0);
});

test("empty target list does nothing", () => {
  let connectCalls = 0;
  let scheduleCalls = 0;

  connectHostsStaggered([], () => {
    connectCalls += 1;
  }, {
    schedule: () => {
      scheduleCalls += 1;
    },
  });

  assert.equal(connectCalls, 0);
  assert.equal(scheduleCalls, 0);
});
