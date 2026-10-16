import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { HostTreeGroupInlineRenameInput } from './HostTreeGroupInlineRenameInput';

test('inline group rename can retry after an asynchronous commit failure', async () => {
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

  let renderer: ReactTestRenderer | null = null;
  let attempts = 0;

  try {
    await act(async () => {
      renderer = create(React.createElement(HostTreeGroupInlineRenameInput, {
        initialName: 'prod',
        onCommit: async () => {
          attempts += 1;
          return attempts > 1;
        },
        onCancel: () => undefined,
      }));
    });
    const input = renderer!.root.findByType('input');

    await act(async () => {
      input.props.onKeyDown({
        key: 'Enter',
        preventDefault: () => undefined,
        stopPropagation: () => undefined,
      });
      await Promise.resolve();
    });
    await act(async () => {
      input.props.onKeyDown({
        key: 'Enter',
        preventDefault: () => undefined,
        stopPropagation: () => undefined,
      });
      await Promise.resolve();
    });

    assert.equal(attempts, 2);
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});
