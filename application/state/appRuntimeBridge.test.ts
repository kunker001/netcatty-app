import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAppSessionRuntime,
  getAppSettingsRuntime,
  getAppVaultRuntime,
  registerAppSessionRuntime,
  registerAppSettingsRuntime,
  registerAppVaultRuntime,
  subscribeAppSessionRuntime,
  subscribeAppSettingsRuntime,
  subscribeAppVaultRuntime,
  type AppSessionRuntime,
  type AppSettingsRuntime,
  type AppVaultRuntime,
} from './appRuntimeBridge';

const vaultRuntime = (label: string) => ({ label }) as unknown as AppVaultRuntime;
const sessionRuntime = (label: string) => ({ label }) as unknown as AppSessionRuntime;
const settingsRuntime = (label: string) => ({ label }) as unknown as AppSettingsRuntime;

test('vault slot exposes the last registered runtime and notifies on change', () => {
  let notifications = 0;
  const unsubscribe = subscribeAppVaultRuntime(() => {
    notifications += 1;
  });

  const first = vaultRuntime('first');
  registerAppVaultRuntime(first);
  assert.equal(getAppVaultRuntime(), first);
  assert.equal(notifications, 1);

  // Re-registering the same identity is what a render with unchanged state
  // does; it must not wake subscribers.
  registerAppVaultRuntime(first);
  assert.equal(notifications, 1);

  const second = vaultRuntime('second');
  registerAppVaultRuntime(second);
  assert.equal(getAppVaultRuntime(), second);
  assert.equal(notifications, 2);

  unsubscribe();
  registerAppVaultRuntime(null);
  assert.equal(getAppVaultRuntime(), null);
  assert.equal(notifications, 2, 'unsubscribed listeners stay quiet');
});

test('session slot is independent from the vault slot', () => {
  let vaultNotifications = 0;
  let sessionNotifications = 0;
  const unsubscribeVault = subscribeAppVaultRuntime(() => {
    vaultNotifications += 1;
  });
  const unsubscribeSession = subscribeAppSessionRuntime(() => {
    sessionNotifications += 1;
  });

  const runtime = sessionRuntime('session');
  registerAppSessionRuntime(runtime);
  assert.equal(getAppSessionRuntime(), runtime);
  assert.equal(sessionNotifications, 1);
  assert.equal(vaultNotifications, 0);

  unsubscribeVault();
  unsubscribeSession();
  registerAppSessionRuntime(null);
});

test('settings slot is independent from the vault and session slots', () => {
  let settingsNotifications = 0;
  let otherNotifications = 0;
  const unsubscribeSettings = subscribeAppSettingsRuntime(() => {
    settingsNotifications += 1;
  });
  const unsubscribeVault = subscribeAppVaultRuntime(() => {
    otherNotifications += 1;
  });
  const unsubscribeSession = subscribeAppSessionRuntime(() => {
    otherNotifications += 1;
  });

  const runtime = settingsRuntime('settings');
  registerAppSettingsRuntime(runtime);
  assert.equal(getAppSettingsRuntime(), runtime);
  assert.equal(settingsNotifications, 1);
  assert.equal(otherNotifications, 0);

  // A re-render with unchanged state re-registers the same identity.
  registerAppSettingsRuntime(runtime);
  assert.equal(settingsNotifications, 1);

  unsubscribeSettings();
  unsubscribeVault();
  unsubscribeSession();
  registerAppSettingsRuntime(null);
  assert.equal(getAppSettingsRuntime(), null);
});
