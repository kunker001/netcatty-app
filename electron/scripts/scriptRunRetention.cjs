"use strict";

const MAX_RETAINED_COMPLETED_RUNS = 200;
const MAX_RETAINED_LOGS_PER_RUN = 200;

function appendRetainedRunLog(run, entry, limit = MAX_RETAINED_LOGS_PER_RUN) {
  if (!run || !Array.isArray(run.logs)) return;
  run.logs.push(entry);
  const overflow = run.logs.length - limit;
  if (overflow > 0) run.logs.splice(0, overflow);
}

function pruneCompletedRuns(runs, limit = MAX_RETAINED_COMPLETED_RUNS) {
  if (!(runs instanceof Map)) return 0;
  const completed = [...runs.values()]
    .filter((run) => Number.isFinite(run?.endedAt))
    .sort((left, right) => (
      left.endedAt - right.endedAt
      || left.startedAt - right.startedAt
      || String(left.runId).localeCompare(String(right.runId))
    ));
  const overflow = completed.length - limit;
  for (let index = 0; index < overflow; index += 1) {
    runs.delete(completed[index].runId);
  }
  return Math.max(0, overflow);
}

module.exports = {
  MAX_RETAINED_COMPLETED_RUNS,
  MAX_RETAINED_LOGS_PER_RUN,
  appendRetainedRunLog,
  pruneCompletedRuns,
};
