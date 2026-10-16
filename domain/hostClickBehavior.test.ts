import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_HOST_CLICK_BEHAVIOR,
  hostCardFocusClassName,
  isHostClickFocusSelected,
  isHostClickBehavior,
  resolveGroupActivateAction,
  resolveHostActivateAction,
  shouldClearHostFocusOnBackgroundClick,
} from './hostClickBehavior';

test('default host click behavior is connect (legacy single-click)', () => {
  assert.equal(DEFAULT_HOST_CLICK_BEHAVIOR, 'connect');
});

test('isHostClickBehavior accepts only known values', () => {
  assert.equal(isHostClickBehavior('connect'), true);
  assert.equal(isHostClickBehavior('select'), true);
  assert.equal(isHostClickBehavior('double'), false);
  assert.equal(isHostClickBehavior(null), false);
});

test('resolveHostActivateAction: multi-select always toggles', () => {
  assert.equal(
    resolveHostActivateAction({
      behavior: 'select',
      isMultiSelectMode: true,
      focusedHostId: 'a',
      hostId: 'a',
    }),
    'toggle-multi',
  );
  assert.equal(
    resolveHostActivateAction({
      behavior: 'connect',
      isMultiSelectMode: true,
      focusedHostId: null,
      hostId: 'a',
    }),
    'toggle-multi',
  );
});

test('resolveHostActivateAction: connect mode always connects', () => {
  assert.equal(
    resolveHostActivateAction({
      behavior: 'connect',
      isMultiSelectMode: false,
      focusedHostId: null,
      hostId: 'a',
    }),
    'connect',
  );
  assert.equal(
    resolveHostActivateAction({
      behavior: 'connect',
      isMultiSelectMode: false,
      focusedHostId: 'a',
      hostId: 'a',
    }),
    'connect',
  );
});

test('resolveHostActivateAction: select mode focuses then connects', () => {
  assert.equal(
    resolveHostActivateAction({
      behavior: 'select',
      isMultiSelectMode: false,
      focusedHostId: null,
      hostId: 'a',
    }),
    'select',
  );
  assert.equal(
    resolveHostActivateAction({
      behavior: 'select',
      isMultiSelectMode: false,
      focusedHostId: 'b',
      hostId: 'a',
    }),
    'select',
  );
  assert.equal(
    resolveHostActivateAction({
      behavior: 'select',
      isMultiSelectMode: false,
      focusedHostId: 'a',
      hostId: 'a',
    }),
    'connect',
  );
});

test('isHostClickFocusSelected only shows a selection in select-before-connect mode', () => {
  assert.equal(
    isHostClickFocusSelected({
      behavior: 'connect',
      isMultiSelectMode: false,
      focusedHostId: 'a',
      hostId: 'a',
    }),
    false,
  );
  assert.equal(
    isHostClickFocusSelected({
      behavior: 'select',
      isMultiSelectMode: false,
      focusedHostId: 'a',
      hostId: 'a',
    }),
    true,
  );
  assert.equal(
    isHostClickFocusSelected({
      behavior: 'select',
      isMultiSelectMode: true,
      focusedHostId: 'a',
      hostId: 'a',
    }),
    false,
  );
});

test('resolveGroupActivateAction: select mode focuses then opens', () => {
  assert.equal(
    resolveGroupActivateAction({
      behavior: 'connect',
      focusedGroupPath: null,
      groupPath: 'prod',
    }),
    'open',
  );
  assert.equal(
    resolveGroupActivateAction({
      behavior: 'select',
      focusedGroupPath: null,
      groupPath: 'prod',
    }),
    'select',
  );
  assert.equal(
    resolveGroupActivateAction({
      behavior: 'select',
      focusedGroupPath: 'prod',
      groupPath: 'prod',
    }),
    'open',
  );
});

test('background clicks clear focus only in select-before-connect mode', () => {
  assert.equal(
    shouldClearHostFocusOnBackgroundClick({
      behavior: 'select',
      isMultiSelectMode: false,
      clickedWithinHostList: true,
      clickedHostOrGroup: false,
    }),
    true,
  );
  assert.equal(
    shouldClearHostFocusOnBackgroundClick({
      behavior: 'select',
      isMultiSelectMode: false,
      clickedWithinHostList: true,
      clickedHostOrGroup: true,
    }),
    false,
  );
  assert.equal(
    shouldClearHostFocusOnBackgroundClick({
      behavior: 'select',
      isMultiSelectMode: true,
      clickedWithinHostList: true,
      clickedHostOrGroup: false,
    }),
    false,
  );
  assert.equal(
    shouldClearHostFocusOnBackgroundClick({
      behavior: 'connect',
      isMultiSelectMode: false,
      clickedWithinHostList: true,
      clickedHostOrGroup: false,
    }),
    false,
  );
  assert.equal(
    shouldClearHostFocusOnBackgroundClick({
      behavior: 'select',
      isMultiSelectMode: false,
      clickedWithinHostList: false,
      clickedHostOrGroup: false,
    }),
    false,
  );
});

test('hostCardFocusClassName: grid recolors border; list uses hover-like fill', () => {
  assert.equal(hostCardFocusClassName('grid', false), '');
  assert.equal(hostCardFocusClassName('list', false), '');
  const grid = hostCardFocusClassName('grid', true);
  assert.match(grid, /border-primary/);
  assert.doesNotMatch(grid, /bg-/);
  const list = hostCardFocusClassName('list', true);
  assert.match(list, /bg-secondary/);
  assert.doesNotMatch(list, /border/);
  assert.doesNotMatch(list, /ring-/);
});
