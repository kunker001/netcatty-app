import test from 'node:test';
import assert from 'node:assert/strict';
import type { SystemProcessInfo } from '../../domain/systemManager/types';
import {
  PROCESS_LIST_CACHE_MAX_ROWS,
  PROCESS_LIST_CACHE_MAX_SESSIONS,
  clearCachedProcessList,
  getCachedProcessList,
  getProcessListCacheStatsForTests,
  resetProcessListCacheForTests,
  setCachedProcessList,
} from './processListCache';

const processRow = (pid: number): SystemProcessInfo => ({
  pid,
  ppid: 1,
  user: 'root',
  stat: 'S',
  command: `process-${pid}`,
  cpuPercent: 0,
  memPercent: 0,
  rssKb: 1,
  vszKb: 1,
  elapsed: '0:01',
});

test.beforeEach(resetProcessListCacheForTests);
test.afterEach(resetProcessListCacheForTests);

test('process list cache stays bounded across session churn and evicts least-recently-used entries', () => {
  const rows = [processRow(1), processRow(2)];
  const now = Date.now();
  for (let index = 0; index < PROCESS_LIST_CACHE_MAX_SESSIONS; index += 1) {
    setCachedProcessList(`session-${index}`, rows, now + index);
  }
  assert.ok(getCachedProcessList('session-0'));
  setCachedProcessList('session-overflow', rows, now + PROCESS_LIST_CACHE_MAX_SESSIONS + 1);

  const stats = getProcessListCacheStatsForTests();
  assert.equal(stats.sessions, PROCESS_LIST_CACHE_MAX_SESSIONS);
  assert.ok(stats.sessionIds.includes('session-0'));
  assert.ok(!stats.sessionIds.includes('session-1'));
});

test('process list cache enforces a total row budget and rejects one oversized response', () => {
  const halfBudget = Array.from(
    { length: Math.floor(PROCESS_LIST_CACHE_MAX_ROWS / 2) + 1 },
    (_, index) => processRow(index),
  );
  setCachedProcessList('left', halfBudget, 1);
  setCachedProcessList('right', halfBudget, 2);
  assert.ok(getProcessListCacheStatsForTests().rows <= PROCESS_LIST_CACHE_MAX_ROWS);

  setCachedProcessList(
    'oversized',
    Array.from({ length: PROCESS_LIST_CACHE_MAX_ROWS + 1 }, (_, index) => processRow(index)),
    3,
  );
  assert.equal(getCachedProcessList('oversized'), null);
});

test('process list cache releases a closed or unmounted session immediately', () => {
  setCachedProcessList('closed-session', [processRow(1)]);
  clearCachedProcessList('closed-session');
  assert.equal(getCachedProcessList('closed-session'), null);
  assert.equal(getProcessListCacheStatsForTests().sessions, 0);
});
