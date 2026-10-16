import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PluginViewTabStore,
  resolveBatchTabCloseFocus,
  resolvePluginViewRequest,
  toPluginViewTabId,
} from './pluginViewTabStore.ts';

function fixture() {
  let activeTabId = 'vault';
  const store = new PluginViewTabStore({
    getActiveTabId: () => activeTabId,
    setActiveTabId: (next) => { activeTabId = next; },
  });
  return { store, getActiveTabId: () => activeTabId };
}

test('plugin view tab IDs include both plugin and contribution ownership', () => {
  assert.equal(
    toPluginViewTabId('com.example.owner', 'shared.view'),
    'plugin-view:com.example.owner:shared.view',
  );
});

test('closing or withdrawing an active plugin view tab returns focus to a safe root page', () => {
  const first = fixture();
  const tab = first.store.open({
    pluginId: 'com.example.owner',
    pluginName: 'Owner',
    viewId: 'com.example.owner.view',
    title: 'View',
  });
  assert.equal(first.getActiveTabId(), tab.id);
  first.store.close(tab.id);
  assert.equal(first.getActiveTabId(), 'vault');

  const second = fixture();
  second.store.open({
    pluginId: 'com.example.owner',
    pluginName: 'Owner',
    viewId: 'com.example.owner.view',
    title: 'View',
  });
  second.store.retain(new Set());
  assert.equal(second.getActiveTabId(), 'vault');
});

test('tab withdrawal notifies lifecycle owners for explicit close and contribution removal', () => {
  const { store } = fixture();
  const closed: string[] = [];
  store.onDidClose(({ tab }) => closed.push(tab.id));
  const first = store.open({
    pluginId: 'com.example.owner',
    pluginName: 'Owner',
    viewId: 'com.example.owner.first',
    title: 'First',
  });
  store.close(first.id);
  const second = store.open({
    pluginId: 'com.example.owner',
    pluginName: 'Owner',
    viewId: 'com.example.owner.second',
    title: 'Second',
  });
  store.retain(new Set());
  assert.deepEqual(closed, [first.id, second.id]);
});

test('localized contribution snapshots refresh titles and icons of already-open tabs', () => {
  const { store } = fixture();
  const tab = store.open({
    pluginId: 'com.example.owner',
    pluginName: 'Owner',
    viewId: 'com.example.owner.view',
    title: 'View',
    icon: { kind: 'theme', name: 'terminal' },
    context: { source: 'menu' },
  });
  store.refreshMetadata([{
    pluginId: 'com.example.owner',
    pluginName: '所有者',
    viewId: 'com.example.owner.view',
    title: '视图',
    icon: { kind: 'theme', name: 'layout-panel' },
  }]);
  assert.deepEqual(store.getTab(tab.id), {
    ...tab,
    pluginName: '所有者',
    title: '视图',
    icon: { kind: 'theme', name: 'layout-panel' },
  });
});

test('an explicit open request takes precedence over the currently active plugin tab', () => {
  const activeTab = { viewId: 'com.example.current', context: { source: 'tab' } };
  assert.deepEqual(resolvePluginViewRequest({
    viewId: 'com.example.requested',
    context: { source: 'menu' },
  }, activeTab), {
    viewId: 'com.example.requested',
    context: { source: 'menu' },
  });
  assert.deepEqual(resolvePluginViewRequest(null, activeTab), activeTab);
});

test('mixed batch closes focus the nearest tab that remains after every target is removed', () => {
  const pluginTab = toPluginViewTabId('com.example.owner', 'com.example.owner.view');
  assert.equal(resolveBatchTabCloseFocus({
    orderedTabIds: ['session-1', pluginTab, 'workspace-1', 'session-2'],
    closingTabIds: new Set(['session-1', pluginTab, 'workspace-1']),
    activeTabId: pluginTab,
  }), 'session-2');
  assert.equal(resolveBatchTabCloseFocus({
    orderedTabIds: ['session-1', pluginTab],
    closingTabIds: new Set(['session-1', pluginTab]),
    activeTabId: pluginTab,
  }), 'vault');
});
