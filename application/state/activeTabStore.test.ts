import assert from 'node:assert/strict';
import test from 'node:test';

import { activeTabStore, fromEditorTabId, isEditorTabId, toEditorTabId } from './activeTabStore';
import { terminalLayoutSuppressStore } from './terminalLayoutSuppressStore';

test('active tab store remembers the previous tab for restore-on-close', () => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window ??= globalThis;

  const marker = `prev-tab-${Date.now()}`;
  const first = `${marker}-a`;
  const second = `${marker}-b`;
  const third = `${marker}-c`;
  const before = activeTabStore.getActiveTabId();

  try {
    activeTabStore.setActiveTabId(first);
    activeTabStore.setActiveTabId(second);
    assert.equal(activeTabStore.getPreviousActiveTabId(), first);

    activeTabStore.setActiveTabId(third);
    assert.equal(activeTabStore.getPreviousActiveTabId(), second);

    activeTabStore.setActiveTabId(first, { recordPrevious: false });
    assert.equal(activeTabStore.getActiveTabId(), first);
    assert.equal(activeTabStore.getPreviousActiveTabId(), second);
  } finally {
    activeTabStore.setActiveTabId(before, { recordPrevious: false });
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = previousWindow;
    }
  }
});

test('editor tab helpers round trip ids', () => {
  assert.equal(toEditorTabId('file-1'), 'editor:file-1');
  assert.equal(fromEditorTabId('editor:file-1'), 'file-1');
});

test('editor tab helper detects editor top-tab ids', () => {
  assert.equal(isEditorTabId('editor:file-1'), true);
  assert.equal(isEditorTabId('session-1'), false);
});

test('active tab changes do not start terminal layout suppression', async () => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window ??= globalThis;

  while (terminalLayoutSuppressStore.getActive()) {
    terminalLayoutSuppressStore.end();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));

  let activeNotifyCount = 0;
  let suppressNotifyCount = 0;
  const unsubscribeActiveTab = activeTabStore.subscribe(() => {
    activeNotifyCount += 1;
  });
  const unsubscribeSuppress = terminalLayoutSuppressStore.subscribe(() => {
    suppressNotifyCount += 1;
  });

  try {
    activeTabStore.setActiveTabId(`no-suppress-test-${Date.now()}`);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(activeNotifyCount, 1);
    assert.equal(suppressNotifyCount, 0);
    assert.equal(terminalLayoutSuppressStore.getActive(), false);
  } finally {
    unsubscribeActiveTab();
    unsubscribeSuppress();
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = previousWindow;
    }
    while (terminalLayoutSuppressStore.getActive()) {
      terminalLayoutSuppressStore.end();
    }
  }
});
