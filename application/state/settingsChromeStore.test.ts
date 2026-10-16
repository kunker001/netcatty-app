import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  DEFAULT_SETTINGS_CHROME_SNAPSHOT,
  getSettingsChromeActions,
  getSettingsChromeSnapshot,
  publishSettingsChromeSnapshot,
  registerSettingsChromeActions,
  settingsChromeSnapshotsEqual,
  subscribeSettingsChrome,
  subscribeSettingsChromeActions,
  type SettingsChromeSnapshot,
} from './settingsChromeStore.ts';

type SnapshotKey = keyof SettingsChromeSnapshot;

/**
 * Derive the probe value instead of hard-coding a field list: the chrome slice
 * grows as surfaces move off the App settings bag, and this suite is about the
 * dedupe contract, not about which fields happen to be in it today.
 */
function mutate(value: unknown): unknown {
  if (typeof value === 'boolean') return !value;
  if (typeof value === 'number') return value + 1;
  if (typeof value === 'string') return `${value}-changed`;
  throw new Error(`Unsupported snapshot field type: ${typeof value}`);
}

test('settingsChromeStore ignores structurally identical republishes', () => {
  const base = getSettingsChromeSnapshot();
  let events = 0;
  const unsubscribe = subscribeSettingsChrome(() => {
    events += 1;
  });

  // useSettingsState rebuilds this object literal on every render, so a fresh
  // identity with unchanged fields must not wake chrome consumers.
  publishSettingsChromeSnapshot({ ...base });
  publishSettingsChromeSnapshot({ ...base });
  assert.equal(events, 0);
  assert.equal(getSettingsChromeSnapshot(), base);

  unsubscribe();
});

test('settingsChromeStore notifies on any single chrome field change', () => {
  const base = getSettingsChromeSnapshot();
  const keys = Object.keys(base) as SnapshotKey[];
  assert.ok(keys.length > 0, 'chrome snapshot must publish at least one field');

  for (const key of keys) {
    let events = 0;
    const unsubscribe = subscribeSettingsChrome(() => {
      events += 1;
    });

    const changed = { ...base, [key]: mutate(base[key]) } as SettingsChromeSnapshot;
    publishSettingsChromeSnapshot(changed);
    assert.equal(events, 1, `expected a notification for ${key}`);
    assert.equal(getSettingsChromeSnapshot()[key], changed[key]);

    publishSettingsChromeSnapshot({ ...changed });
    assert.equal(events, 1, `expected no repeat notification for ${key}`);

    publishSettingsChromeSnapshot(base);
    assert.equal(events, 2, `expected a restore notification for ${key}`);

    unsubscribe();
  }

  assert.equal(getSettingsChromeSnapshot(), base);
});

test('settingsChromeStore stops notifying after unsubscribe', () => {
  const base = getSettingsChromeSnapshot();
  const [firstKey] = Object.keys(base) as SnapshotKey[];
  let events = 0;
  const unsubscribe = subscribeSettingsChrome(() => {
    events += 1;
  });

  unsubscribe();
  publishSettingsChromeSnapshot({
    ...base,
    [firstKey]: mutate(base[firstKey]),
  } as SettingsChromeSnapshot);
  assert.equal(events, 0);

  publishSettingsChromeSnapshot(base);
});

test('chrome snapshot fields stay in sync with what useSettingsState publishes', () => {
  // The whole point of the slice is that chrome leaves can stop reading the
  // App settings bag. A field the publisher forgets would silently freeze at
  // its default, so pin the two shapes together.
  const source = readFileSync(new URL('./useSettingsState.ts', import.meta.url), 'utf8');
  const callStart = source.indexOf('publishSettingsChromeSnapshot({');
  assert.notEqual(callStart, -1, 'useSettingsState must publish the chrome slice');
  const callEnd = source.indexOf('});', callStart);
  assert.notEqual(callEnd, -1);

  const published = source
    .slice(callStart, callEnd)
    .split('\n')
    .slice(1)
    .map((line) => line.trim().match(/^([A-Za-z0-9_]+)\s*[:,]/)?.[1])
    .filter((name): name is string => Boolean(name));

  assert.deepEqual(
    published.slice().sort(),
    Object.keys(DEFAULT_SETTINGS_CHROME_SNAPSHOT).sort(),
  );
});

test('settingsChromeSnapshotsEqual compares by field, not object identity', () => {
  const base = DEFAULT_SETTINGS_CHROME_SNAPSHOT;
  assert.equal(settingsChromeSnapshotsEqual({ ...base }, { ...base }), true);
  assert.equal(
    settingsChromeSnapshotsEqual(base, { ...base, windowOpacity: 0.8 }),
    false,
  );
  assert.equal(
    settingsChromeSnapshotsEqual(base, { ...base, showSftpTab: !base.showSftpTab }),
    false,
  );
});

test('registerSettingsChromeActions exposes the theme and opacity setters', () => {
  const calls: string[] = [];
  let actionEvents = 0;
  const unsubscribe = subscribeSettingsChromeActions(() => {
    actionEvents += 1;
  });

  registerSettingsChromeActions({
    setTheme: () => calls.push('theme'),
    setWindowOpacity: () => calls.push('opacity'),
  });

  const actions = getSettingsChromeActions();
  assert.ok(actions);
  actions.setTheme('light');
  actions.setWindowOpacity(0.5);
  assert.deepEqual(calls, ['theme', 'opacity']);
  assert.equal(actionEvents, 1);

  registerSettingsChromeActions(null);
  assert.equal(getSettingsChromeActions(), null);
  assert.equal(actionEvents, 2);

  unsubscribe();
});

test('setter churn never invalidates the chrome value snapshot', () => {
  // useSettingsState re-registers on every setter identity change; chrome
  // consumers of the value snapshot must not re-render for that.
  let valueEvents = 0;
  const unsubscribe = subscribeSettingsChrome(() => {
    valueEvents += 1;
  });

  registerSettingsChromeActions({ setTheme: () => {}, setWindowOpacity: () => {} });
  registerSettingsChromeActions({ setTheme: () => {}, setWindowOpacity: () => {} });
  assert.equal(valueEvents, 0);

  registerSettingsChromeActions(null);
  unsubscribe();
});
