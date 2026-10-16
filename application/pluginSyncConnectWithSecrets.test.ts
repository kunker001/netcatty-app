import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { storePluginSyncSecretsThenConnect } from './pluginSyncConnectWithSecrets.ts';

describe('storePluginSyncSecretsThenConnect', () => {
  it('deletes just-created secret keys when connect rejects', async () => {
    const putCalls: Array<{ key: string; value: string }> = [];
    const deletedKeys: string[][] = [];
    let connectCalls = 0;

    await assert.rejects(
      () => storePluginSyncSecretsThenConnect({
        providerId: 'plugin:sync.example',
        secrets: [
          { secretKey: 'sync-credential', value: 'bad-password' },
          { secretKey: 'sync-credential:token', value: 'bad-token' },
        ],
        putSecret: async ({ key, value }) => {
          putCalls.push({ key, value });
          return { kind: 'secret', id: `ref-${key}`, key };
        },
        deleteSecrets: async ({ keys }) => {
          deletedKeys.push([...keys]);
          return { deleted: keys.length };
        },
        connect: async () => {
          connectCalls += 1;
          throw new Error('auth failed');
        },
      }),
      /auth failed/,
    );

    assert.equal(connectCalls, 1);
    assert.deepEqual(putCalls, [
      { key: 'sync-credential', value: 'bad-password' },
      { key: 'sync-credential:token', value: 'bad-token' },
    ]);
    assert.deepEqual(deletedKeys, [['sync-credential', 'sync-credential:token']]);
  });

  it('does not delete secrets when connect succeeds', async () => {
    const deletedKeys: string[][] = [];
    await storePluginSyncSecretsThenConnect({
      providerId: 'plugin:sync.example',
      secrets: [{ secretKey: 'sync-credential', value: 'ok' }],
      putSecret: async ({ key }) => ({ kind: 'secret', id: 'ref-1', key }),
      deleteSecrets: async ({ keys }) => {
        deletedKeys.push([...keys]);
        return { deleted: keys.length };
      },
      connect: async () => {},
    });
    assert.deepEqual(deletedKeys, []);
  });

  it('does not delete when reusing an existing credential without new secrets', async () => {
    const deletedKeys: string[][] = [];
    const existing = { kind: 'secret' as const, id: 'existing-ref', key: 'sync-credential' };
    await assert.rejects(
      () => storePluginSyncSecretsThenConnect({
        providerId: 'plugin:sync.example',
        secrets: [],
        existingCredential: existing,
        putSecret: async () => {
          throw new Error('put should not run');
        },
        deleteSecrets: async ({ keys }) => {
          deletedKeys.push([...keys]);
          return { deleted: keys.length };
        },
        connect: async () => {
          throw new Error('network failed');
        },
      }),
      /network failed/,
    );
    assert.deepEqual(deletedKeys, []);
  });

  it('deletes secrets that were put before a later put fails', async () => {
    const deletedKeys: string[][] = [];
    await assert.rejects(
      () => storePluginSyncSecretsThenConnect({
        providerId: 'plugin:sync.example',
        secrets: [
          { secretKey: 'sync-credential', value: 'first' },
          { secretKey: 'sync-credential:token', value: 'second' },
        ],
        putSecret: async ({ key }) => {
          if (key === 'sync-credential:token') throw new Error('put failed');
          return { kind: 'secret', id: 'ref-1', key };
        },
        deleteSecrets: async ({ keys }) => {
          deletedKeys.push([...keys]);
          return { deleted: keys.length };
        },
        connect: async () => {
          throw new Error('connect should not run');
        },
      }),
      /put failed/,
    );
    assert.deepEqual(deletedKeys, [['sync-credential']]);
  });

  it('keeps overwritten secrets when reconnect connect rejects', async () => {
    const deletedKeys: string[][] = [];
    const restoredKeys: string[][] = [];
    await assert.rejects(
      () => storePluginSyncSecretsThenConnect({
        providerId: 'plugin:sync.example',
        secrets: [{ secretKey: 'sync-credential', value: 'bad-password' }],
        putSecret: async ({ key }) => ({
          kind: 'secret',
          id: 'ref-overwritten',
          key,
          created: false,
        }),
        deleteSecrets: async ({ keys }) => {
          deletedKeys.push([...keys]);
          return { deleted: keys.length };
        },
        restoreSecrets: async ({ keys }) => {
          restoredKeys.push([...keys]);
          return { restored: keys.length };
        },
        connect: async () => {
          throw new Error('auth failed');
        },
      }),
      /auth failed/,
    );
    assert.deepEqual(deletedKeys, []);
    assert.deepEqual(restoredKeys, [['sync-credential']]);
  });
});
