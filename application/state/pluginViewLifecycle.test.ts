import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PluginViewLifecycleController,
  consumeClosedPluginViewInstance,
  reconcilePluginViewTabCatalog,
  markPluginViewOpenTokensClosed,
  reconcileClosedPluginView,
  rememberClosedPluginViewInstance,
  resolvePluginViewSnapshotSelection,
  shouldReconcilePluginViewTabCatalog,
  withdrawPluginViewTab,
  type HostedPluginViewState,
} from './pluginViewLifecycle.ts';
import { PluginViewTabStore } from './pluginViewTabStore.ts';

function view(id: string, tabId?: string): HostedPluginViewState {
  return {
    id,
    viewId: `view.${id}`,
    scopeId: 'window:main',
    retainContextWhenHidden: false,
    ...(tabId ? { tabId } : {}),
  };
}

test('host close events clear the active renderer instance and identify its native tab', () => {
  const current = view('active', 'plugin-view:publisher.plugin:view.active');
  const result = reconcileClosedPluginView({
    current,
    retained: new Map([['retained', view('retained')]]),
    instanceId: 'active',
  });

  assert.equal(result.current, null);
  assert.equal(result.matchedCurrent, true);
  assert.equal(result.closedTabId, current.tabId);
  assert.equal(result.retained.size, 1);
});

test('host close events remove retained instances without dismissing another active view', () => {
  const current = view('active');
  const retainedTab = view('retained-closed', 'plugin-view:publisher.plugin:view.retained');
  const result = reconcileClosedPluginView({
    current,
    retained: new Map([
      ['closed', retainedTab],
      ['kept', view('retained-kept')],
    ]),
    instanceId: 'retained-closed',
  });

  assert.equal(result.current, current);
  assert.equal(result.matchedCurrent, false);
  assert.equal(result.matchedRetained, true);
  assert.deepEqual([...result.retained.keys()], ['kept']);
  assert.equal(result.closedTabId, retainedTab.tabId);
});

test('explicit native-tab close destroys active and retained instances instead of retaining them', () => {
  const tabId = 'plugin-view:publisher.plugin:view.shared';
  const result = withdrawPluginViewTab({
    current: view('active', tabId),
    retained: new Map([
      ['same-tab', view('retained-same', tabId)],
      ['other-tab', view('retained-other', 'plugin-view:publisher.plugin:view.other')],
    ]),
    tabId,
  });

  assert.equal(result.current, null);
  assert.equal(result.matchedCurrent, true);
  assert.equal(result.matchedRetained, true);
  assert.deepEqual(result.instanceIds, ['active', 'retained-same']);
  assert.deepEqual([...result.retained.keys()], ['other-tab']);
});

test('an early host close tombstone is consumed when the open response arrives later', () => {
  const tombstones = new Set<string>();
  rememberClosedPluginViewInstance(tombstones, 'instance-early');
  assert.equal(consumeClosedPluginViewInstance(tombstones, 'instance-early'), true);
  assert.equal(consumeClosedPluginViewInstance(tombstones, 'instance-early'), false);

  for (let index = 0; index < 300; index += 1) {
    rememberClosedPluginViewInstance(tombstones, `instance-${index}`);
  }
  assert.equal(tombstones.size, 256);
  assert.equal(tombstones.has('instance-0'), false);
});

test('explicit close marks only in-flight opens owned by the closed surface', () => {
  const first = Symbol('first');
  const second = Symbol('second');
  const explicitlyClosed = new Set<symbol>();
  const opening = new Map<string, Set<symbol>>([
    ['window:main\0view.first', new Set([first])],
    ['window:main\0view.second', new Set([second])],
  ]);

  assert.equal(markPluginViewOpenTokensClosed(
    opening,
    explicitlyClosed,
    'window:main\0view.first',
  ), 1);
  assert.deepEqual([...explicitlyClosed], [first]);
  assert.equal(markPluginViewOpenTokensClosed(opening, explicitlyClosed, null), 0);
});

test('locale-only snapshot refresh keeps the owned view alive without weakening context fail-closed behavior', () => {
  const previous = {
    requestViewId: 'publisher.plugin.view',
    contextKey: '{"netcatty.surface":"view"}',
    value: { id: 'resolved-view' },
  };
  assert.equal(resolvePluginViewSnapshotSelection({
    resolved: null,
    previous,
    loading: true,
    requestedViewId: previous.requestViewId,
    contextKey: previous.contextKey,
  }), previous.value);
  assert.equal(resolvePluginViewSnapshotSelection({
    resolved: null,
    previous,
    loading: true,
    requestedViewId: previous.requestViewId,
    contextKey: '{"netcatty.surface":"terminal/toolbar"}',
  }), null);
  assert.equal(resolvePluginViewSnapshotSelection({
    resolved: null,
    previous,
    loading: false,
    requestedViewId: previous.requestViewId,
    contextKey: previous.contextKey,
  }), null);
});

test('native tab catalog reconciliation pauses for every in-flight query', () => {
  assert.equal(shouldReconcilePluginViewTabCatalog({
    loading: true,
  }), false);
  assert.equal(shouldReconcilePluginViewTabCatalog({
    loading: false,
  }), true);
});

test('active-tab context refresh cannot withdraw the plugin tab that triggered it', () => {
  let activeTabId = 'vault';
  const store = new PluginViewTabStore({
    getActiveTabId: () => activeTabId,
    setActiveTabId: (next) => { activeTabId = next; },
  });
  const tab = store.open({
    pluginId: 'publisher.plugin',
    pluginName: 'Plugin',
    viewId: 'publisher.plugin.view',
    title: 'View',
  });

  assert.equal(reconcilePluginViewTabCatalog({
    loading: true,
    plugins: [],
    store,
  }), false);
  assert.deepEqual(store.getTabs().map((candidate) => candidate.id), [tab.id]);
  assert.equal(activeTabId, tab.id);

  const plugins = [{
    id: 'publisher.plugin',
    displayName: 'Plugin',
    views: [{
      id: 'publisher.plugin.view',
      title: 'Localized View',
      location: 'tab',
    }],
  }] as unknown as NetcattyPluginContributionSnapshot['plugins'];
  assert.equal(reconcilePluginViewTabCatalog({
    loading: false,
    plugins,
    store,
  }), true);
  assert.deepEqual(store.getTabs().map((candidate) => candidate.id), [tab.id]);
  assert.equal(store.getTabs()[0]?.title, 'Localized View');
  assert.equal(activeTabId, tab.id);
});

test('lifecycle controller owns retained views, open tokens, tombstones, and teardown', () => {
  const controller = new PluginViewLifecycleController<HostedPluginViewState>();
  const tabId = 'plugin-view:publisher.plugin:view.shared';
  const active = view('active', tabId);
  const retained = view('retained');
  controller.setCurrent(active);
  controller.retain('window:main\0view.retained', retained);

  const token = controller.beginOpen({
    viewKey: 'window:main\0view.active',
    tabId,
  });
  const closed = controller.handleTabClose(tabId);
  assert.deepEqual(closed.instanceIds, [active.id]);
  assert.equal(controller.shouldCloseOpen(token), true);
  controller.finishOpen({ token, viewKey: 'window:main\0view.active', tabId });
  assert.equal(controller.shouldCloseOpen(token), false);

  const early = controller.handleHostClose('instance-before-open-response');
  assert.equal(early.matchedCurrent, false);
  assert.equal(early.matchedRetained, false);
  assert.equal(controller.consumeHostClose('instance-before-open-response'), true);

  assert.deepEqual(controller.drain().map((candidate) => candidate.id), [retained.id]);
  assert.equal(controller.getCurrent(), null);
});
