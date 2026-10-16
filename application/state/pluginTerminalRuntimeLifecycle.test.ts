import assert from 'node:assert/strict';
import test from 'node:test';

import { publishPluginTerminalRuntimeLifecycleEvent } from './pluginTerminalRuntimeLifecycle.ts';

test('terminal runtime lifecycle events share the canonical session lifecycle sink', () => {
  const calls: unknown[][] = [];
  const lifecycle = {
    onCommandSubmitted() { calls.push(['commandSubmitted']); },
    onCommandCompleted() { calls.push(['commandCompleted']); },
    onCwdChanged(cwd: string | null) { calls.push(['cwdChanged', cwd]); },
    onTitleChanged(title: string | null) { calls.push(['titleChanged', title]); },
    onResized(cols: number, rows: number) { calls.push(['resized', cols, rows]); },
    onAlternateScreenChanged(alternateScreen: boolean) {
      calls.push(['alternateScreenChanged', alternateScreen]);
    },
  };

  publishPluginTerminalRuntimeLifecycleEvent(lifecycle, 'cwdChanged', { cwd: '/srv/app' });
  publishPluginTerminalRuntimeLifecycleEvent(lifecycle, 'cwdChanged');
  publishPluginTerminalRuntimeLifecycleEvent(lifecycle, 'titleChanged', { title: 'Application' });
  publishPluginTerminalRuntimeLifecycleEvent(lifecycle, 'titleChanged');
  publishPluginTerminalRuntimeLifecycleEvent(lifecycle, 'resized', { cols: 120, rows: 40 });
  publishPluginTerminalRuntimeLifecycleEvent(lifecycle, 'alternateScreenChanged', { alternateScreen: true });
  publishPluginTerminalRuntimeLifecycleEvent(lifecycle, 'commandSubmitted');
  publishPluginTerminalRuntimeLifecycleEvent(lifecycle, 'commandCompleted');

  assert.deepEqual(calls, [
    ['cwdChanged', '/srv/app'],
    ['cwdChanged', null],
    ['titleChanged', 'Application'],
    ['titleChanged', null],
    ['resized', 120, 40],
    ['alternateScreenChanged', true],
    ['commandSubmitted'],
    ['commandCompleted'],
  ]);
});
