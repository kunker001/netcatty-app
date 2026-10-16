import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('../..', import.meta.url);

function readProjectFile(path: string): string {
  return readFileSync(join(root.pathname, path), 'utf8');
}

test('DebouncedTextarea keeps draft locally and commits on debounce/blur', () => {
  const source = readProjectFile('components/settings/DebouncedTextarea.tsx');

  assert.match(source, /useState\(value\)/);
  assert.match(source, /onDraftChangeRef\.current\?\.\(next\)/);
  assert.match(source, /setTimeout\(\(\) =>/);
  assert.match(source, /onBlur/);
  assert.match(source, /onCommitRef\.current\(draft\)/);
  assert.match(source, /draftRef\.current !== committedRef\.current/);
});

test('settings appearance uses debounced custom CSS textarea with live preview', () => {
  const source = readProjectFile('components/settings/tabs/SettingsAppearanceTab.tsx');

  assert.match(source, /DebouncedTextarea/);
  assert.match(source, /applyCustomCssToDocument/);
  assert.match(source, /onDraftChange=\{applyCustomCssToDocument\}/);
});
