import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  collectOwnedPluginMenus,
  createPluginContributionRefreshGuard,
  failClosedPluginContributionLoad,
  resolvePluginContributionLoadState,
  usePluginContributions,
} from './usePluginContributions';

function Probe() {
  const contributions = usePluginContributions();
  return (
    <span>
      {contributions.available ? 'available' : 'unavailable'}:{contributions.snapshot.plugins.length}
    </span>
  );
}

test('plugin contributions fail closed during server rendering', () => {
  assert.equal(renderToStaticMarkup(<Probe />), '<span>unavailable:0</span>');
});

test('plugin contribution refresh failures discard the last successful snapshot', () => {
  const failure = failClosedPluginContributionLoad('bridge unavailable');
  assert.equal(failure.available, false);
  assert.equal(failure.snapshot.plugins.length, 0);
  assert.match(failure.error.message, /bridge unavailable/u);
});

test('plugin contribution query changes hide the prior snapshot synchronously', () => {
  const staleSnapshot = {
    locale: 'en',
    plugins: [{ id: 'com.example.stale' }],
  } as NetcattyPluginContributionSnapshot;
  const selected = resolvePluginContributionLoadState({
    currentQueryKey: '{"context":{"terminal.sessionId":"session-2"}}',
    loadedQueryKey: '{"context":{"terminal.sessionId":"session-1"}}',
    snapshot: staleSnapshot,
    available: true,
    loading: false,
  });

  assert.equal(selected.available, false);
  assert.equal(selected.loading, true);
  assert.equal(selected.snapshot.plugins.length, 0);
});

test('plugin contribution refreshes reject stale asynchronous results', async () => {
  const guard = createPluginContributionRefreshGuard();
  const committed: string[] = [];
  const oldRequestIsCurrent = guard.begin();
  let resolveOld: (() => void) | undefined;
  const oldRequest = new Promise<void>((resolve) => { resolveOld = resolve; }).then(() => {
    if (oldRequestIsCurrent()) committed.push('old');
  });

  const newRequestIsCurrent = guard.begin();
  if (newRequestIsCurrent()) committed.push('new');
  resolveOld?.();
  await oldRequest;

  assert.deepEqual(committed, ['new']);
  assert.equal(oldRequestIsCurrent(), false);
  assert.equal(newRequestIsCurrent(), true);
  guard.invalidate();
  assert.equal(newRequestIsCurrent(), false);
});

test('owned menu rendering inherits command icons when a placement has no override', () => {
  const commandIcon = { kind: 'theme', name: 'play' } as const;
  const plugins = [{
    id: 'com.example.menu',
    commands: [{ id: 'com.example.menu.run', title: 'Run', enabled: true, icon: commandIcon }],
    menus: [{
      id: 'com.example.menu:menu:0',
      command: 'com.example.menu.run',
      location: 'terminal/toolbar',
      title: 'Run',
      visible: true,
      enabled: true,
    }],
  }] as unknown as NetcattyPluginContributionSnapshot['plugins'];

  assert.deepEqual(collectOwnedPluginMenus(plugins)[0], {
    ...plugins[0].menus[0],
    pluginId: 'com.example.menu',
    icon: commandIcon,
  });
});
