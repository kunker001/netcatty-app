import assert from 'node:assert/strict';
import test from 'node:test';

import { pluginConfigurationMatchesSchema } from './pluginConfigurationSchema.ts';

const schema = {
  type: 'object',
  properties: {
    endpoint: { type: 'string', minLength: 1, maxLength: 64 },
    port: { type: 'integer', minimum: 1, maximum: 65535 },
    secure: { type: 'boolean' },
    mode: { type: 'string', enum: ['direct', 'relay'] },
  },
  required: ['endpoint', 'port'],
  additionalProperties: false,
};

test('plugin connection configuration uses the declared restricted schema', () => {
  assert.equal(pluginConfigurationMatchesSchema(schema, {
    endpoint: 'example.com', port: 443, secure: true, mode: 'direct',
  }), true);
  assert.equal(pluginConfigurationMatchesSchema(schema, { endpoint: '', port: 443 }), false);
  assert.equal(pluginConfigurationMatchesSchema(schema, { endpoint: 'example.com', port: 1.5 }), false);
  assert.equal(pluginConfigurationMatchesSchema(schema, { endpoint: 'example.com', port: 443, extra: true }), false);
});

test('unsafe or malformed plugin configuration schemas fail closed', () => {
  assert.equal(pluginConfigurationMatchesSchema({ ...schema, $ref: 'https://attacker.invalid/schema' }, {}), false);
  assert.equal(pluginConfigurationMatchesSchema({
    type: 'object', properties: {}, additionalProperties: true,
  }, {}), false);
  assert.equal(pluginConfigurationMatchesSchema({
    type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 1,
  }, []), false);
});

test('plugin configuration string lengths are counted as Unicode characters', () => {
  const stringSchema = { type: 'string', minLength: 2, maxLength: 2 };
  assert.equal(pluginConfigurationMatchesSchema(stringSchema, 'ab'), true);
  assert.equal(pluginConfigurationMatchesSchema(stringSchema, '😀'), false);
  assert.equal(pluginConfigurationMatchesSchema(stringSchema, '😀a'), true);
  assert.equal(pluginConfigurationMatchesSchema({ type: 'string', maxLength: 1 }, '😀'), true);
});
