import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAppearanceChromeSnapshot,
  publishAppearanceChromeSnapshot,
  subscribeAppearanceChrome,
} from './appearanceChromeStore.ts';

test('appearanceChromeStore notifies subscribers only when accent fields change', () => {
  const events: string[] = [];
  const unsubscribe = subscribeAppearanceChrome(() => {
    const snap = getAppearanceChromeSnapshot();
    events.push(`${snap.accentMode}:${snap.customAccent}`);
  });

  publishAppearanceChromeSnapshot({ accentMode: 'custom', customAccent: '#ff0000' });
  assert.equal(events.at(-1), 'custom:#ff0000');
  assert.equal(getAppearanceChromeSnapshot().customAccent, '#ff0000');

  publishAppearanceChromeSnapshot({ accentMode: 'custom', customAccent: '#ff0000' });
  assert.equal(events.length, 1);

  publishAppearanceChromeSnapshot({ accentMode: 'custom', customAccent: '#00ff00' });
  assert.equal(events.at(-1), 'custom:#00ff00');

  publishAppearanceChromeSnapshot({ accentMode: 'theme', customAccent: '#00ff00' });
  assert.equal(events.at(-1), 'theme:#00ff00');

  unsubscribe();
});
