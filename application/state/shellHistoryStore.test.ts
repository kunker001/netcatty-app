import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getShellHistorySnapshot,
  publishShellHistorySnapshot,
  subscribeShellHistory,
} from './shellHistoryStore.ts';

test('shellHistoryStore notifies subscribers only when the snapshot identity changes', () => {
  const events: number[] = [];
  const unsubscribe = subscribeShellHistory(() => {
    events.push(getShellHistorySnapshot().length);
  });

  const first = [{ id: '1', command: 'ls', hostId: 'h', hostLabel: 'h', sessionId: 's', timestamp: 1 }];
  publishShellHistorySnapshot(first);
  assert.equal(events.at(-1), 1);
  assert.equal(getShellHistorySnapshot(), first);

  publishShellHistorySnapshot(first);
  assert.equal(events.length, 1);

  const second = [...first, { id: '2', command: 'pwd', hostId: 'h', hostLabel: 'h', sessionId: 's', timestamp: 2 }];
  publishShellHistorySnapshot(second);
  assert.equal(events.at(-1), 2);

  unsubscribe();
});
