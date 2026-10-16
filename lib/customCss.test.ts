import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('..', import.meta.url);

function readProjectFile(path: string): string {
  return readFileSync(join(root.pathname, path), 'utf8');
}

test('custom CSS helper uses a single stable style element id', () => {
  const source = readProjectFile('lib/customCss.ts');

  assert.match(source, /netcatty-custom-css/);
  assert.match(source, /styleEl\.textContent = css/);
});

test('settings state applies custom CSS through the shared helper', () => {
  const source = readProjectFile('application/state/useSettingsState.ts');

  assert.match(source, /applyCustomCssToDocument\(customCSS\)/);
});
