import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { collectSidePanelPanes } from '../../domain/sidePanelLayout.ts';
import { useTerminalSidePanelLayoutState } from './useTerminalSidePanelLayoutState.ts';

test('terminal side panel layouts stay isolated and keep one pane per tool', async () => {
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  let state: ReturnType<typeof useTerminalSidePanelLayoutState> | null = null;
  let renderer: ReactTestRenderer | null = null;

  const Probe = () => {
    state = useTerminalSidePanelLayoutState();
    return null;
  };

  try {
    await act(async () => {
      renderer = create(React.createElement(Probe));
    });
    await act(async () => {
      state?.setSidePanelOpenTabs(new Map([
        ['terminal-a', 'notes'],
        ['terminal-b', 'scripts'],
      ]));
    });

    const layoutA = state?.sidePanelLayouts.get('terminal-a');
    const layoutB = state?.sidePanelLayouts.get('terminal-b');
    assert.ok(layoutA);
    assert.ok(layoutB);

    await act(async () => {
      state?.splitPane('terminal-a', 'history', 'vertical', {
        paneId: 'pane-history',
        splitId: 'split-a',
      }, 400);
    });
    assert.deepEqual(
      collectSidePanelPanes(state!.sidePanelLayouts.get('terminal-a')!.root).map((pane) => pane.tool),
      ['notes', 'history'],
    );
    assert.deepEqual(
      collectSidePanelPanes(state!.sidePanelLayouts.get('terminal-b')!.root).map((pane) => pane.tool),
      ['scripts'],
    );

    await act(async () => {
      state?.splitPane('terminal-a', 'notes', 'horizontal', {
        paneId: 'unused-pane',
        splitId: 'unused-split',
      }, 400);
    });
    const focused = state!.sidePanelLayouts.get('terminal-a')!;
    assert.equal(collectSidePanelPanes(focused.root).length, 2);
    assert.equal(state!.sidePanelOpenTabs.get('terminal-a'), 'notes');

    // External open paths still write the focused-tool map. They must replace
    // only the focused pane, then focus an existing pane without duplicating it.
    await act(async () => {
      state?.setSidePanelOpenTabs((current) => new Map(current).set('terminal-a', 'system'));
    });
    assert.deepEqual(
      collectSidePanelPanes(state!.sidePanelLayouts.get('terminal-a')!.root).map((pane) => pane.tool),
      ['system', 'history'],
    );
    await act(async () => {
      state?.setSidePanelOpenTabs((current) => new Map(current).set('terminal-a', 'history'));
    });
    const externallyFocused = state!.sidePanelLayouts.get('terminal-a')!;
    assert.deepEqual(collectSidePanelPanes(externallyFocused.root).map((pane) => pane.tool), ['system', 'history']);
    assert.equal(state!.sidePanelOpenTabs.get('terminal-a'), 'history');
    assert.equal(
      collectSidePanelPanes(externallyFocused.root).find((pane) => pane.id === externallyFocused.focusedPaneId)?.tool,
      'history',
    );
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});

test('closing the final pane removes only that terminal side panel state', async () => {
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  let state: ReturnType<typeof useTerminalSidePanelLayoutState> | null = null;
  let renderer: ReactTestRenderer | null = null;

  const Probe = () => {
    state = useTerminalSidePanelLayoutState();
    return null;
  };

  try {
    await act(async () => {
      renderer = create(React.createElement(Probe));
    });
    await act(async () => {
      state?.setSidePanelOpenTabs(new Map([
        ['terminal-a', 'notes'],
        ['terminal-b', 'scripts'],
      ]));
    });
    const paneId = state!.sidePanelLayouts.get('terminal-a')!.focusedPaneId;

    let closedLast = false;
    await act(async () => {
      closedLast = state!.closePane('terminal-a', paneId);
    });

    assert.equal(closedLast, true);
    assert.equal(state!.sidePanelLayouts.has('terminal-a'), false);
    assert.equal(state!.sidePanelOpenTabs.has('terminal-a'), false);
    assert.equal(state!.sidePanelLayouts.has('terminal-b'), true);
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});
