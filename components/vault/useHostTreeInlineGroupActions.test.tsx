import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { hostTreeInlineGroupEditStore } from '../../application/state/hostTreeInlineGroupEditStore';
import { useHostTreeInlineGroupActions } from './useHostTreeInlineGroupActions';

test('inline group rename stays open when the Vault commit is superseded', async () => {
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

  let renderer: ReactTestRenderer | null = null;
  let startRename: ((groupPath: string) => void) | undefined;
  let commitRename: ((name: string) => Promise<boolean>) | undefined;
  const selectedPaths: Array<string | null> = [];

  const Probe = () => {
    const actions = useHostTreeInlineGroupActions({
      customGroups: ['prod'],
      hosts: [],
      managedSources: [],
      onUpdateCustomGroups: () => undefined,
      onCommitGroupPathChange: async () => ({ ok: false, superseded: true }),
      selectedGroupPath: 'prod',
      setSelectedGroupPath: (path) => selectedPaths.push(path),
      ensurePathExpanded: () => undefined,
      unnamedGroupLabel: 'New group',
      t: (key) => key,
    });
    startRename = actions.startInlineRenameGroup;
    commitRename = actions.commitInlineGroupRename;
    return null;
  };

  try {
    await act(async () => {
      renderer = create(React.createElement(Probe));
    });
    act(() => {
      startRename?.('prod');
    });
    await act(async () => {
      await commitRename?.('production');
    });

    assert.deepEqual(selectedPaths, []);
    assert.equal(hostTreeInlineGroupEditStore.getEdit()?.groupPath, 'prod');
  } finally {
    hostTreeInlineGroupEditStore.clear();
    await act(async () => {
      renderer?.unmount();
    });
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});
