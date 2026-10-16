import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canRetainPluginViewInScope,
  resolvePluginRetainedViewKey,
  resolvePluginViewWindowScope,
} from './pluginViewScopes';

test('plugin view window scopes distinguish path, query, and hash routes', () => {
  const first = resolvePluginViewWindowScope({
    pathname: '/index.html',
    search: '?workspace=one',
    hash: '#/settings',
  });
  const second = resolvePluginViewWindowScope({
    pathname: '/index.html',
    search: '?workspace=one',
    hash: '#/terminal',
  });

  assert.equal(first, 'window:/index.html?workspace=one#/settings');
  assert.notEqual(first, second);
});

test('plugin view window scopes remain deterministic and bounded for long routes', () => {
  const route = {
    pathname: '/index.html',
    search: '',
    hash: `#/${'nested/'.repeat(80)}`,
  };
  const scope = resolvePluginViewWindowScope(route);

  assert.equal(scope, resolvePluginViewWindowScope(route));
  assert.ok(scope.length <= 256);
  assert.ok(!scope.includes('\0'));
  assert.notEqual(scope, resolvePluginViewWindowScope({ ...route, hash: `${route.hash}different` }));
});

test('retained plugin views are isolated by both view and route scope', () => {
  assert.notEqual(
    resolvePluginRetainedViewKey('com.example.view', 'window:/index.html#/one'),
    resolvePluginRetainedViewKey('com.example.view', 'window:/index.html#/two'),
  );
  assert.equal(canRetainPluginViewInScope('window:/index.html#/one', 'window:/index.html#/one'), true);
  assert.equal(canRetainPluginViewInScope('window:/index.html#/one', 'window:/index.html#/two'), false);
});
