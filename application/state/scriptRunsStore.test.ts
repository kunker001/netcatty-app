import assert from 'node:assert/strict';
import test from 'node:test';

import { setScriptRuns, getScriptRuns } from './scriptAutomationCoordinator.ts';
import {
  getScriptRunsSnapshot,
  subscribeScriptRuns,
} from './scriptRunsStore.ts';

test('setScriptRuns publishes to scriptRunsStore for Scripts panel subscribers', () => {
  const events: number[] = [];
  const unsubscribe = subscribeScriptRuns(() => {
    events.push(getScriptRunsSnapshot().length);
  });

  setScriptRuns([
    {
      runId: 'r1',
      sessionId: 's1',
      status: 'running',
      startedAt: 1,
      logs: [],
    },
  ]);

  assert.equal(getScriptRuns().length, 1);
  assert.equal(getScriptRunsSnapshot().length, 1);
  assert.equal(getScriptRunsSnapshot()[0]?.runId, 'r1');
  assert.ok(events.includes(1));

  setScriptRuns([]);
  assert.equal(getScriptRunsSnapshot().length, 0);

  unsubscribe();
});
