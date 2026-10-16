"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  MAX_RETAINED_COMPLETED_RUNS,
  MAX_RETAINED_LOGS_PER_RUN,
  appendRetainedRunLog,
  pruneCompletedRuns,
} = require("./scriptRunRetention.cjs");

test("completed script history is bounded without removing active runs", () => {
  const runs = new Map();
  for (let index = 0; index < MAX_RETAINED_COMPLETED_RUNS + 25; index += 1) {
    runs.set(`completed-${index}`, {
      runId: `completed-${index}`,
      startedAt: index,
      endedAt: index + 1,
    });
  }
  runs.set("active", { runId: "active", startedAt: 0 });

  assert.equal(pruneCompletedRuns(runs), 25);
  assert.equal(runs.size, MAX_RETAINED_COMPLETED_RUNS + 1);
  assert.equal(runs.has("active"), true);
  assert.equal(runs.has("completed-0"), false);
  assert.equal(runs.has(`completed-${MAX_RETAINED_COMPLETED_RUNS + 24}`), true);
});

test("script logs keep only the newest bounded tail", () => {
  const run = { logs: [] };
  for (let index = 0; index < MAX_RETAINED_LOGS_PER_RUN + 30; index += 1) {
    appendRetainedRunLog(run, { message: `log-${index}` });
  }

  assert.equal(run.logs.length, MAX_RETAINED_LOGS_PER_RUN);
  assert.equal(run.logs[0].message, "log-30");
  assert.equal(run.logs.at(-1).message, `log-${MAX_RETAINED_LOGS_PER_RUN + 29}`);
});
