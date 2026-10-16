import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cloudSyncDialogsSource = readFileSync(
  new URL('./cloud-sync/CloudSyncDialogs.tsx', import.meta.url),
  'utf8',
);

test('cloud revision rows use a neutral hover surface for arbitrary accent colors', () => {
  assert.match(cloudSyncDialogsSource, /hover:bg-muted\/50/);
  assert.doesNotMatch(cloudSyncDialogsSource, /hover:bg-accent(?:\/50)?/);
});
