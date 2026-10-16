import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTerminalPluginContributionContext,
  resolveActivePluginKeybindingContext,
} from './pluginContributionContexts.ts';
import type { TerminalSession, Workspace } from '../../types.ts';

const sessions: TerminalSession[] = [
  {
    id: 'session-1',
    hostId: 'host-1',
    hostLabel: 'Host 1',
    username: 'root',
    hostname: 'example.com',
    status: 'connected',
    protocol: 'ssh',
    workspaceId: 'workspace-1',
  },
  {
    id: 'session-2',
    hostId: 'local-2',
    hostLabel: 'Local',
    username: '',
    hostname: 'localhost',
    status: 'disconnected',
    protocol: 'local',
  },
];

const workspaces: Workspace[] = [{
  id: 'workspace-1',
  title: 'Workspace',
  root: { id: 'pane-1', type: 'pane', sessionId: 'session-1' },
}];

test('builds a resource-bearing terminal command context', () => {
  assert.deepEqual(buildTerminalPluginContributionContext({
    surface: 'terminal/context',
    sessionId: 'session-1',
    status: 'connected',
    hostId: 'host-1',
    hostProtocol: 'ssh',
    workspaceId: 'workspace-1',
    hasSelection: true,
    alternateScreen: false,
    reconnectable: false,
  }), {
    'netcatty.surface': 'terminal/context',
    'terminal.sessionId': 'session-1',
    'terminal.status': 'connected',
    'host.id': 'host-1',
    'host.protocol': 'ssh',
    'workspace.id': 'workspace-1',
    'terminal.hasSelection': true,
    'terminal.alternateScreen': false,
    'terminal.reconnectable': false,
  });
});

test('resolves the focused workspace session for global keybindings', () => {
  assert.deepEqual(resolveActivePluginKeybindingContext({
    activeTabId: 'workspace-1',
    sessions,
    workspaces,
  }), {
    'netcatty.surface': 'keybinding',
    'terminal.sessionId': 'session-1',
    'terminal.status': 'connected',
    'host.id': 'host-1',
    'host.protocol': 'ssh',
    'workspace.id': 'workspace-1',
    'netcatty.activeTabId': 'workspace-1',
  });
});

test('resolves standalone sessions and fails closed for non-terminal tabs', () => {
  assert.equal(
    resolveActivePluginKeybindingContext({ activeTabId: 'session-2', sessions, workspaces })['terminal.sessionId'],
    'session-2',
  );
  assert.deepEqual(resolveActivePluginKeybindingContext({
    activeTabId: 'vault',
    sessions,
    workspaces,
  }), {
    'netcatty.surface': 'keybinding',
    'netcatty.activeTabId': 'vault',
  });
});
