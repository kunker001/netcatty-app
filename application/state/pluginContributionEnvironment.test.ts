import assert from 'node:assert/strict';
import test from 'node:test';

import { selectPluginThemeTokens } from './pluginContributionEnvironment.ts';

test('plugin theme tokens come from the themed app surface style', () => {
  assert.deepEqual(selectPluginThemeTokens({
    '--background': '220 10% 10%',
    '--foreground': '0 0% 98%',
    '--primary': '210 90% 55%',
    colorScheme: 'dark',
    '--unknown-plugin-token': 'ignored',
  }), {
    '--background': '220 10% 10%',
    '--foreground': '0 0% 98%',
    '--primary': '210 90% 55%',
  });
});
