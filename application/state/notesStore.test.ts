import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EMPTY_NOTES_SNAPSHOT,
  getEmptyNotesSnapshot,
  getNotesActions,
  getNotesSnapshot,
  publishNotesSnapshot,
  registerNotesActions,
  subscribeNotes,
  subscribeNotesNoop,
} from './notesStore.ts';

test('notesStore notifies subscribers only when snapshot identity changes', () => {
  const events: number[] = [];
  const unsubscribe = subscribeNotes(() => {
    events.push(getNotesSnapshot().notes.length);
  });

  const firstNotes = [{
    id: 'n1',
    title: 'One',
    content: 'body',
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    order: 1000,
  }];
  const firstGroups = ['Ops'];
  publishNotesSnapshot({ notes: firstNotes, noteGroups: firstGroups });
  assert.equal(events.at(-1), 1);
  assert.equal(getNotesSnapshot().notes, firstNotes);
  assert.equal(getNotesSnapshot().noteGroups, firstGroups);

  publishNotesSnapshot({ notes: firstNotes, noteGroups: firstGroups });
  assert.equal(events.length, 1);

  const secondNotes = [
    ...firstNotes,
    {
      id: 'n2',
      title: 'Two',
      content: 'more',
      tags: [],
      createdAt: 2,
      updatedAt: 2,
      order: 2000,
    },
  ];
  publishNotesSnapshot({ notes: secondNotes, noteGroups: firstGroups });
  assert.equal(events.at(-1), 2);

  publishNotesSnapshot({ notes: secondNotes, noteGroups: ['Ops', 'DB'] });
  assert.equal(events.length, 3);
  assert.deepEqual(getNotesSnapshot().noteGroups, ['Ops', 'DB']);

  unsubscribe();
});

test('notesStore gated helpers stay empty and never notify', () => {
  let called = 0;
  const unsub = subscribeNotesNoop(() => {
    called += 1;
  });
  publishNotesSnapshot({
    notes: [{
      id: 'n1',
      title: 'One',
      content: 'body',
      tags: [],
      createdAt: 1,
      updatedAt: 1,
      order: 1000,
    }],
    noteGroups: ['Ops'],
  });
  assert.equal(called, 0);
  assert.equal(getEmptyNotesSnapshot(), EMPTY_NOTES_SNAPSHOT);
  assert.equal(getEmptyNotesSnapshot().notes.length, 0);
  unsub();
});

test('useNotesStore source gates subscribe when enabled is false', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('./notesStore.ts', import.meta.url), 'utf8');
  assert.match(source, /enabled \? subscribeNotes : subscribeNotesNoop/);
  assert.match(source, /enabled \? subscribeNotesActions : subscribeNotesNoop/);
  assert.match(source, /getNotesSnapshot/);
  assert.doesNotMatch(
    source,
    /enabled \? getNotesSnapshot : getEmptyNotesSnapshot/,
    'hidden notes mounts should keep the last live snapshot, not flash empty',
  );
});

test('registerNotesActions exposes update handlers', () => {
  const calls: string[] = [];
  registerNotesActions({
    updateNotes: () => {
      calls.push('notes');
    },
    updateNoteGroups: () => {
      calls.push('groups');
    },
  });
  const actions = getNotesActions();
  assert.ok(actions);
  actions!.updateNotes([]);
  actions!.updateNoteGroups([]);
  assert.deepEqual(calls, ['notes', 'groups']);
  registerNotesActions(null);
  assert.equal(getNotesActions(), null);
});
