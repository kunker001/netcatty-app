import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('ChainPanel virtualizes the searchable available-host picker', () => {
  const source = readFileSync(new URL('./ChainPanel.tsx', import.meta.url), 'utf8');

  assert.match(source, /FixedSizeVirtualList/);
  assert.match(source, /items=\{filteredHosts\}/);
  assert.match(source, /CHAIN_HOST_VIEWPORT_HEIGHT/);
  assert.match(source, /onClick=\{\(\) => onAddHost\(host\.id\)\}/);
});
