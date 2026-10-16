import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BUILTIN_CLOUD_PROVIDERS,
  assertCloudProviderId,
  isBuiltinCloudProvider,
  isPluginCloudProviderId,
  providerConnectionStorageKey,
} from './cloudProviderIds';

describe('cloudProviderIds', () => {
  it('recognizes built-in providers', () => {
    for (const id of BUILTIN_CLOUD_PROVIDERS) {
      assert.equal(isBuiltinCloudProvider(id), true);
      assert.equal(isPluginCloudProviderId(id), false);
      assert.equal(providerConnectionStorageKey(id), `netcatty_provider_${id}_v1`);
    }
  });

  it('accepts namespaced plugin provider IDs without coercing them to built-ins', () => {
    const id = 'com.example.backup.sync';
    assert.equal(isPluginCloudProviderId(id), true);
    assert.equal(isBuiltinCloudProvider(id), false);
    assert.equal(providerConnectionStorageKey(id), `netcatty_provider_plugin_v1:${id}`);
    assert.equal(assertCloudProviderId(id), id);
  });

  it('rejects empty or NUL-containing provider IDs', () => {
    assert.throws(() => assertCloudProviderId(''), /invalid/i);
    assert.throws(() => assertCloudProviderId('bad\0id'), /invalid/i);
  });
});
