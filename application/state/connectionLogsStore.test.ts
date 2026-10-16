import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConnectionLog } from '../../domain/models.ts';
import {
  EMPTY_CONNECTION_LOGS_SNAPSHOT,
  getConnectionLogsActions,
  getConnectionLogsSnapshot,
  getEmptyConnectionLogsSnapshot,
  publishConnectionLogsSnapshot,
  registerConnectionLogsActions,
  subscribeConnectionLogs,
  subscribeConnectionLogsActions,
} from './connectionLogsStore.ts';

const baseLog: ConnectionLog = {
  id: 'log-1',
  sessionId: 'session-1',
  hostId: 'host-1',
  hostLabel: 'Example',
  hostname: 'example.com',
  username: 'user',
  protocol: 'ssh',
  startTime: 1000,
  localUsername: 'local',
  localHostname: 'machine',
  saved: false,
};

test('connectionLogsStore notifies subscribers only when the log array identity changes', () => {
  const events: number[] = [];
  const unsubscribe = subscribeConnectionLogs(() => {
    events.push(getConnectionLogsSnapshot().connectionLogs.length);
  });

  const firstLogs = [baseLog];
  publishConnectionLogsSnapshot({ connectionLogs: firstLogs });
  assert.equal(events.at(-1), 1);
  assert.equal(getConnectionLogsSnapshot().connectionLogs, firstLogs);

  // Same identity must not wake the Vault logs section on unrelated renders.
  publishConnectionLogsSnapshot({ connectionLogs: firstLogs });
  assert.equal(events.length, 1);

  const secondLogs = [baseLog, { ...baseLog, id: 'log-2', startTime: 2000 }];
  publishConnectionLogsSnapshot({ connectionLogs: secondLogs });
  assert.equal(events.at(-1), 2);
  assert.equal(events.length, 2);

  unsubscribe();
  publishConnectionLogsSnapshot({ connectionLogs: [] });
  assert.equal(events.length, 2);
});

test('connectionLogsStore exposes a frozen empty snapshot for gated mounts', () => {
  assert.equal(getEmptyConnectionLogsSnapshot(), EMPTY_CONNECTION_LOGS_SNAPSHOT);
  assert.equal(getEmptyConnectionLogsSnapshot().connectionLogs.length, 0);
  assert.equal(Object.isFrozen(EMPTY_CONNECTION_LOGS_SNAPSHOT), true);
});

test('registerConnectionLogsActions exposes the vault log mutators', () => {
  const calls: string[] = [];
  const actionEvents: number[] = [];
  const unsubscribe = subscribeConnectionLogsActions(() => {
    actionEvents.push(actionEvents.length);
  });

  registerConnectionLogsActions({
    updateConnectionLog: () => {
      calls.push('update');
    },
    toggleConnectionLogSaved: () => {
      calls.push('toggle');
    },
    deleteConnectionLog: () => {
      calls.push('delete');
    },
    clearUnsavedConnectionLogs: () => {
      calls.push('clear');
    },
  });

  const actions = getConnectionLogsActions();
  assert.ok(actions);
  actions.updateConnectionLog('log-1', { saved: true });
  actions.toggleConnectionLogSaved('log-1');
  actions.deleteConnectionLog('log-1');
  actions.clearUnsavedConnectionLogs();
  assert.deepEqual(calls, ['update', 'toggle', 'delete', 'clear']);
  assert.equal(actionEvents.length, 1);

  registerConnectionLogsActions(null);
  assert.equal(getConnectionLogsActions(), null);
  assert.equal(actionEvents.length, 2);

  unsubscribe();
});

test('connectionLogsStore keeps values and actions on independent slots', () => {
  const valueEvents: number[] = [];
  const actionEvents: number[] = [];
  const unsubValues = subscribeConnectionLogs(() => {
    valueEvents.push(valueEvents.length);
  });
  const unsubActions = subscribeConnectionLogsActions(() => {
    actionEvents.push(actionEvents.length);
  });

  // Re-registering unstable mutator identities must not invalidate the logs.
  registerConnectionLogsActions({
    updateConnectionLog: () => {},
    toggleConnectionLogSaved: () => {},
    deleteConnectionLog: () => {},
    clearUnsavedConnectionLogs: () => {},
  });
  assert.equal(valueEvents.length, 0);
  assert.equal(actionEvents.length, 1);

  publishConnectionLogsSnapshot({ connectionLogs: [baseLog] });
  assert.equal(valueEvents.length, 1);
  assert.equal(actionEvents.length, 1);

  registerConnectionLogsActions(null);
  unsubValues();
  unsubActions();
});
