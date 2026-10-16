import assert from 'node:assert/strict';
import test from 'node:test';
import { planPluginSyncConnect, hasPluginProviderStoredConfig } from './pluginSyncConnect';

const requiredSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    endpoint: { type: 'string', minLength: 1 },
    enabled: { type: 'boolean' },
  },
  required: ['endpoint'],
};

const optionalSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    region: { type: 'string' },
  },
};

test('planPluginSyncConnect reuses stored config including falsy scalars', () => {
  assert.deepEqual(
    planPluginSyncConnect({ hasStoredConfig: true, storedConfig: false }),
    { action: 'connect', configuration: false },
  );
  assert.deepEqual(
    planPluginSyncConnect({ hasStoredConfig: true, storedConfig: 0, configurationSchema: requiredSchema }),
    { action: 'connect', configuration: 0 },
  );
  assert.deepEqual(
    planPluginSyncConnect({ hasStoredConfig: true, storedConfig: '', configurationSchema: requiredSchema }),
    { action: 'connect', configuration: '' },
  );
  assert.deepEqual(
    planPluginSyncConnect({ hasStoredConfig: true, storedConfig: null, configurationSchema: { type: 'null' } }),
    { action: 'connect', configuration: null },
  );
});

test('hasPluginProviderStoredConfig uses property presence including null', () => {
  assert.equal(hasPluginProviderStoredConfig({ config: null }), true);
  assert.equal(hasPluginProviderStoredConfig({ config: false }), true);
  assert.equal(hasPluginProviderStoredConfig({}), false);
  assert.equal(hasPluginProviderStoredConfig(undefined), false);
});

test('planPluginSyncConnect prompts when schema rejects empty config', () => {
  assert.deepEqual(
    planPluginSyncConnect({ hasStoredConfig: false, storedConfig: undefined, configurationSchema: requiredSchema }),
    { action: 'prompt' },
  );
});

test('planPluginSyncConnect uses empty object when schema allows it or is absent', () => {
  assert.deepEqual(
    planPluginSyncConnect({ hasStoredConfig: false, storedConfig: undefined }),
    { action: 'connect', configuration: {} },
  );
  assert.deepEqual(
    planPluginSyncConnect({ hasStoredConfig: false, storedConfig: undefined, configurationSchema: optionalSchema }),
    { action: 'connect', configuration: {} },
  );
});
