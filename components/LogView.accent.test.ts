import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./LogView.tsx', import.meta.url), 'utf8');

test('LogView applies live custom accent at the leaf from appearanceChromeStore', () => {
  assert.match(source, /useAppearanceChromeStore/);
  assert.match(source, /applyCustomAccentToTerminalTheme\(baseTheme, accentMode, customAccent\)/);
  // Must not rely on an accent-baked defaultTerminalTheme from AppShell bags.
  assert.match(
    source,
    /published defaultTerminalTheme is the stable base catalog/,
  );
});
