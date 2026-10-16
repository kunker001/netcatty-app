import { useSyncExternalStore } from 'react';

import type { VaultNote } from '../../domain/models';

type Listener = () => void;

export type NotesSnapshot = {
  notes: readonly VaultNote[];
  noteGroups: readonly string[];
};

export type NotesActions = {
  updateNotes: (notes: VaultNote[]) => boolean | void;
  updateNoteGroups: (groups: string[]) => void;
};

const EMPTY_NOTES: readonly VaultNote[] = Object.freeze([]);
const EMPTY_NOTE_GROUPS: readonly string[] = Object.freeze([]);

export const EMPTY_NOTES_SNAPSHOT: NotesSnapshot = Object.freeze({
  notes: EMPTY_NOTES,
  noteGroups: EMPTY_NOTE_GROUPS,
});

/**
 * External store for vault notes so Notes / AI side-panel consumers can
 * subscribe without forcing TerminalLayer re-renders on every note edit.
 */
class NotesStore {
  private snapshot: NotesSnapshot = EMPTY_NOTES_SNAPSHOT;
  private actions: NotesActions | null = null;
  private listeners = new Set<Listener>();
  private actionListeners = new Set<Listener>();

  getSnapshot = (): NotesSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  setSnapshot(next: NotesSnapshot): void {
    if (
      this.snapshot.notes === next.notes
      && this.snapshot.noteGroups === next.noteGroups
    ) {
      return;
    }
    this.snapshot = next;
    for (const listener of this.listeners) {
      listener();
    }
  }

  getActions = (): NotesActions | null => this.actions;

  subscribeActions = (listener: Listener): (() => void) => {
    this.actionListeners.add(listener);
    return () => {
      this.actionListeners.delete(listener);
    };
  };

  setActions(next: NotesActions | null): void {
    if (this.actions === next) return;
    this.actions = next;
    for (const listener of this.actionListeners) {
      listener();
    }
  }
}

export const notesStore = new NotesStore();

export function publishNotesSnapshot(snapshot: NotesSnapshot): void {
  notesStore.setSnapshot(snapshot);
}

export function getNotesSnapshot(): NotesSnapshot {
  return notesStore.getSnapshot();
}

export function subscribeNotes(listener: Listener): () => void {
  return notesStore.subscribe(listener);
}

/** No-op subscribe for gated (hidden) panel mounts. */
export function subscribeNotesNoop(_listener: Listener): () => void {
  return () => {};
}

export function getEmptyNotesSnapshot(): NotesSnapshot {
  return EMPTY_NOTES_SNAPSHOT;
}

export function registerNotesActions(actions: NotesActions | null): void {
  notesStore.setActions(actions);
}

export function getNotesActions(): NotesActions | null {
  return notesStore.getActions();
}

export function subscribeNotesActions(listener: Listener): () => void {
  return notesStore.subscribeActions(listener);
}

const noopUpdateNotes: NotesActions['updateNotes'] = () => {};
const noopUpdateNoteGroups: NotesActions['updateNoteGroups'] = () => {};

/**
 * Subscribe to notes catalog + vault mutation actions for Notes / AI panels.
 *
 * Pass `{ enabled: false }` for retained-but-hidden mounts (e.g. terminal
 * notes side panel) so vault note publishes do not re-render them. Snapshot
 * reads still use the live store so reopen does not flash empty data.
 */
export function useNotesStore(options?: { enabled?: boolean }): {
  notes: VaultNote[];
  noteGroups: string[];
  updateNotes: NotesActions['updateNotes'];
  updateNoteGroups: NotesActions['updateNoteGroups'];
} {
  const enabled = options?.enabled !== false;
  const snapshot = useSyncExternalStore(
    enabled ? subscribeNotes : subscribeNotesNoop,
    getNotesSnapshot,
    getNotesSnapshot,
  );
  const actions = useSyncExternalStore(
    enabled ? subscribeNotesActions : subscribeNotesNoop,
    getNotesActions,
    getNotesActions,
  );
  return {
    notes: snapshot.notes as VaultNote[],
    noteGroups: snapshot.noteGroups as string[],
    updateNotes: actions?.updateNotes ?? noopUpdateNotes,
    updateNoteGroups: actions?.updateNoteGroups ?? noopUpdateNoteGroups,
  };
}
