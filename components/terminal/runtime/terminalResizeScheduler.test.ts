import assert from 'node:assert/strict';
import test from 'node:test';

import { createTerminalResizeScheduler } from './terminalResizeScheduler.ts';

const wait = (durationMs: number) => new Promise((resolve) => setTimeout(resolve, durationMs));

test('dispose cancels a pending terminal resize callback', async () => {
  const applied: Array<{ sessionId: string; cols: number; rows: number }> = [];
  const scheduler = createTerminalResizeScheduler(5, (request) => applied.push(request));

  scheduler.schedule({ sessionId: 'session-1', cols: 120, rows: 40 });
  scheduler.dispose();
  await wait(20);

  assert.deepEqual(applied, []);
});

test('a later terminal resize replaces the pending callback', async () => {
  const applied: Array<{ sessionId: string; cols: number; rows: number }> = [];
  const scheduler = createTerminalResizeScheduler(5, (request) => applied.push(request));

  scheduler.schedule({ sessionId: 'session-1', cols: 100, rows: 30 });
  scheduler.schedule({ sessionId: 'session-1', cols: 140, rows: 50 });
  await wait(20);

  assert.deepEqual(applied, [{ sessionId: 'session-1', cols: 140, rows: 50 }]);
  scheduler.dispose();
});

test('terminal resize scheduling remains inert after disposal', async () => {
  const applied: Array<{ sessionId: string; cols: number; rows: number }> = [];
  const scheduler = createTerminalResizeScheduler(5, (request) => applied.push(request));

  scheduler.dispose();
  scheduler.schedule({ sessionId: 'session-1', cols: 160, rows: 60 });
  await wait(20);

  assert.deepEqual(applied, []);
});
