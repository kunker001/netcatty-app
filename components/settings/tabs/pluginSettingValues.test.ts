import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePluginStructuredSettingValue } from './pluginSettingValues';

test('structured plugin settings preserve an unchanged array value on blur', () => {
  const value = [{ name: 'first' }, { name: 'second' }];
  assert.equal(parsePluginStructuredSettingValue(value), value);
});

test('structured plugin settings parse edited JSON arrays', () => {
  assert.deepEqual(parsePluginStructuredSettingValue('[{"name":"edited"}]'), [{ name: 'edited' }]);
});

test('structured plugin settings reject non-array JSON values', () => {
  assert.throws(() => parsePluginStructuredSettingValue('{"name":"invalid"}'), /must be a JSON array/u);
});
