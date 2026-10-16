import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  planPluginSyncCredential,
  pluginSyncSecretStoreKeys,
  syncConfigurationSchemaWithoutSecretRequirements,
} from './pluginSyncCredential.ts';

describe('planPluginSyncCredential', () => {
  it('extracts all secret keys and strips them from configuration', () => {
    const plan = planPluginSyncCredential({
      endpoint: 'https://dav.example',
      username: 'alice',
      password: 's3cret',
      token: 'also-secret',
    });
    assert.equal(plan.plaintextSecret, 's3cret');
    assert.equal(plan.extractedFrom, 'password');
    assert.equal(plan.secrets.length, 2);
    assert.deepEqual(
      plan.secrets.map((entry) => ({ key: entry.key, value: entry.value })),
      [
        { key: 'password', value: 's3cret' },
        { key: 'token', value: 'also-secret' },
      ],
    );
    assert.deepEqual(plan.configuration, {
      endpoint: 'https://dav.example',
      username: 'alice',
    });
  });

  it('extracts writeOnly schema fields that are not well-known names', () => {
    const plan = planPluginSyncCredential(
      {
        endpoint: 'https://dav.example',
        appPassword: 'hidden',
      },
      {
        configurationSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            endpoint: { type: 'string' },
            appPassword: { type: 'string', writeOnly: true },
          },
          required: ['endpoint', 'appPassword'],
        },
      },
    );
    assert.equal(plan.secrets.length, 1);
    assert.equal(plan.secrets[0]?.key, 'appPassword');
    assert.equal(plan.secrets[0]?.secretKey, 'sync-credential:appPassword');
    assert.deepEqual(plan.configuration, { endpoint: 'https://dav.example' });
  });

  it('passes through non-object configs unchanged', () => {
    assert.deepEqual(planPluginSyncCredential(null), {
      configuration: null,
      secrets: [],
      secretKey: 'sync-credential',
    });
    assert.deepEqual(planPluginSyncCredential('x'), {
      configuration: 'x',
      secrets: [],
      secretKey: 'sync-credential',
    });
  });

  it('leaves configs without secrets alone', () => {
    const configuration = { endpoint: 'https://dav.example', username: 'alice' };
    assert.deepEqual(planPluginSyncCredential(configuration), {
      configuration,
      secrets: [],
      secretKey: 'sync-credential',
    });
  });
});

describe('syncConfigurationSchemaWithoutSecretRequirements', () => {
  it('drops known secret keys and writeOnly fields from required', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        endpoint: { type: 'string' },
        password: { type: 'string' },
        appPassword: { type: 'string', writeOnly: true },
      },
      required: ['endpoint', 'password', 'appPassword'],
    };
    assert.deepEqual(syncConfigurationSchemaWithoutSecretRequirements(schema), {
      ...schema,
      required: ['endpoint'],
    });
  });
});

describe('pluginSyncSecretStoreKeys', () => {
  it('includes primary and secondary credential keys', () => {
    assert.ok(pluginSyncSecretStoreKeys().includes('sync-credential'));
    assert.ok(pluginSyncSecretStoreKeys().includes('sync-credential:token'));
    assert.ok(pluginSyncSecretStoreKeys(['appPassword']).includes('sync-credential:appPassword'));
  });
});
