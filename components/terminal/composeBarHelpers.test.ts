import assert from 'node:assert/strict';
import test from 'node:test';

import type { Snippet } from '../../types';
import {
  buildSnippetIdKey,
  clampComposeBarHeight,
  COMPOSE_BAR_BUILTIN_SNIPPET_IDS,
  COMPOSE_BAR_MAX_HEIGHT,
  COMPOSE_BAR_MIN_HEIGHT,
  filterComposeBarSnippets,
  resolveComposeBarDefaultSeedIds,
} from './composeBarHelpers';

const sampleSnippets: Snippet[] = [
  { id: 'a', label: 'List files', command: 'ls -la', package: 'utils' },
  { id: 'b', label: 'Disk usage', command: 'df -h', package: 'monitor' },
  { id: 'c', label: 'Restart nginx', command: 'systemctl restart nginx' },
];

test('clampComposeBarHeight clamps below minimum', () => {
  assert.equal(clampComposeBarHeight(10), COMPOSE_BAR_MIN_HEIGHT);
});

test('clampComposeBarHeight clamps above maximum', () => {
  assert.equal(clampComposeBarHeight(999), COMPOSE_BAR_MAX_HEIGHT);
});

test('clampComposeBarHeight passes through valid values', () => {
  assert.equal(clampComposeBarHeight(150), 150);
});

test('filterComposeBarSnippets returns all snippets sorted when query is empty', () => {
  assert.deepEqual(
    filterComposeBarSnippets(sampleSnippets, '').map((s) => s.id),
    ['b', 'a', 'c'],
  );
});

test('filterComposeBarSnippets filters by label, command, and package', () => {
  assert.deepEqual(filterComposeBarSnippets(sampleSnippets, 'nginx').map((s) => s.id), ['c']);
  assert.deepEqual(filterComposeBarSnippets(sampleSnippets, 'df').map((s) => s.id), ['b']);
  assert.deepEqual(filterComposeBarSnippets(sampleSnippets, 'utils').map((s) => s.id), ['a']);
});

test('filterComposeBarSnippets returns empty list when nothing matches', () => {
  assert.deepEqual(filterComposeBarSnippets(sampleSnippets, 'missing'), []);
});

test('buildSnippetIdKey joins ids with a null delimiter', () => {
  assert.equal(buildSnippetIdKey(['a', 'b']), 'a\0b');
});

test('resolveComposeBarDefaultSeedIds uses vault snippets when available', () => {
  assert.deepEqual(
    resolveComposeBarDefaultSeedIds(sampleSnippets).map((id) => id),
    ['b', 'a', 'c'],
  );
});

test('resolveComposeBarDefaultSeedIds falls back to built-ins when vault is empty', () => {
  assert.deepEqual(
    resolveComposeBarDefaultSeedIds([]),
    COMPOSE_BAR_BUILTIN_SNIPPET_IDS.slice(0, 4),
  );
});
