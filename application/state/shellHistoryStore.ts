import type { ShellHistoryEntry } from '../../domain/models';

type Listener = () => void;

/**
 * External store for shell history so History side-panel / snippets consumers
 * can subscribe without forcing TerminalLayer re-renders on every command.
 */
class ShellHistoryStore {
  private snapshot: readonly ShellHistoryEntry[] = [];
  private listeners = new Set<Listener>();

  getSnapshot = (): readonly ShellHistoryEntry[] => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  setSnapshot(next: readonly ShellHistoryEntry[]): void {
    if (this.snapshot === next) return;
    this.snapshot = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const shellHistoryStore = new ShellHistoryStore();

export function publishShellHistorySnapshot(entries: readonly ShellHistoryEntry[]): void {
  shellHistoryStore.setSnapshot(entries);
}

export function getShellHistorySnapshot(): readonly ShellHistoryEntry[] {
  return shellHistoryStore.getSnapshot();
}

export function subscribeShellHistory(listener: Listener): () => void {
  return shellHistoryStore.subscribe(listener);
}
