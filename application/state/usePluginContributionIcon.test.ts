import assert from 'node:assert/strict';
import test from 'node:test';

import {
  pluginContributionIconRequestKey,
  selectPluginContributionIcon,
} from './usePluginContributionIcon.ts';

test('resolved package icons fail closed synchronously when ownership changes', () => {
  const icon = { kind: 'package', light: 'assets/icon.png' } as const;
  const firstKey = pluginContributionIconRequestKey('com.example.first', icon);
  const secondKey = pluginContributionIconRequestKey('com.example.second', icon);
  const state = { requestKey: firstKey as string, icon: { light: 'data:image/png;base64,first' } };

  assert.deepEqual(selectPluginContributionIcon(firstKey, state), state.icon);
  assert.equal(selectPluginContributionIcon(secondKey, state), null);
  assert.equal(pluginContributionIconRequestKey('com.example.first', { kind: 'theme', name: 'terminal' }), null);
});
