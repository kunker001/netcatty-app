import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  collectSelectableHostIdsInGroup,
  getGroupSelectionState,
  hostMatchesGroupPath,
  toggleIdsInSelection,
} from './selectHostSelection';

describe('hostMatchesGroupPath', () => {
  it('matches exact and nested group paths', () => {
    assert.equal(hostMatchesGroupPath({ group: 'prod' }, 'prod'), true);
    assert.equal(hostMatchesGroupPath({ group: 'prod/web' }, 'prod'), true);
    assert.equal(hostMatchesGroupPath({ group: 'prod' }, 'prod/web'), false);
    assert.equal(hostMatchesGroupPath({ group: 'staging' }, 'prod'), false);
    assert.equal(hostMatchesGroupPath({}, 'prod'), false);
    assert.equal(hostMatchesGroupPath({ group: 'prod' }, ''), false);
  });
});

describe('collectSelectableHostIdsInGroup', () => {
  it('returns non-serial hosts under the group including nested paths', () => {
    const hosts = [
      { id: 'a', group: 'prod' },
      { id: 'b', group: 'prod/web' },
      { id: 'c', group: 'staging' },
      { id: 'serial', group: 'prod', protocol: 'serial' as const },
      { id: 'root' },
    ];
    assert.deepEqual(collectSelectableHostIdsInGroup(hosts, 'prod'), ['a', 'b']);
    assert.deepEqual(collectSelectableHostIdsInGroup(hosts, 'prod/web'), ['b']);
  });
});

describe('getGroupSelectionState', () => {
  it('reports none, partial, and all', () => {
    assert.equal(getGroupSelectionState([], ['a', 'b']), 'none');
    assert.equal(getGroupSelectionState(['a'], ['a', 'b']), 'partial');
    assert.equal(getGroupSelectionState(['a', 'b', 'c'], ['a', 'b']), 'all');
    assert.equal(getGroupSelectionState(['x'], []), 'none');
  });
});

describe('toggleIdsInSelection', () => {
  it('adds missing ids when the group is not fully selected', () => {
    assert.deepEqual(toggleIdsInSelection(['a'], ['a', 'b']), ['a', 'b']);
    assert.deepEqual(toggleIdsInSelection([], ['a', 'b']), ['a', 'b']);
  });

  it('removes all ids when every id is already selected', () => {
    assert.deepEqual(toggleIdsInSelection(['a', 'b', 'c'], ['a', 'b']), ['c']);
  });

  it('returns a copy when toggling an empty id list', () => {
    const selected = ['a'];
    const next = toggleIdsInSelection(selected, []);
    assert.deepEqual(next, ['a']);
    assert.notEqual(next, selected);
  });
});
