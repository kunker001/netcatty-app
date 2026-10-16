import { useSyncExternalStore } from 'react';

type Listener = () => void;

class SessionActivityStore {
  private snapshot: Record<string, boolean> = {};
  private listeners = new Set<Listener>();

  getSnapshot = () => this.snapshot;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  setTabActive = (tabId: string, hasActivity: boolean) => {
    const alreadyActive = !!this.snapshot[tabId];
    if (alreadyActive === hasActivity) return;

    if (hasActivity) {
      this.snapshot = { ...this.snapshot, [tabId]: true };
    } else {
      const { [tabId]: _removed, ...rest } = this.snapshot;
      this.snapshot = rest;
    }

    this.emit();
  };

  clearTab = (tabId: string) => {
    this.setTabActive(tabId, false);
  };

  clearTabs = (tabIds: Iterable<string>) => {
    let changed = false;
    const next = { ...this.snapshot };

    for (const tabId of tabIds) {
      if (!next[tabId]) continue;
      delete next[tabId];
      changed = true;
    }

    if (!changed) return;
    this.snapshot = next;
    this.emit();
  };

  prune = (validTabIds: Set<string>) => {
    let changed = false;
    const next: Record<string, boolean> = {};

    for (const tabId of Object.keys(this.snapshot)) {
      if (validTabIds.has(tabId)) {
        next[tabId] = true;
      } else {
        changed = true;
      }
    }

    if (!changed) return;
    this.snapshot = next;
    this.emit();
  };
}

export const sessionActivityStore = new SessionActivityStore();

export const useSessionActivityMap = () => {
  return useSyncExternalStore(
    sessionActivityStore.subscribe,
    sessionActivityStore.getSnapshot,
    sessionActivityStore.getSnapshot,
  );
};

/**
 * Per-tab activity boolean. Store notify is still global, but React skips re-render
 * when this tab's boolean is unchanged (Object.is on the snapshot primitive).
 */
export const useSessionActivity = (tabId: string): boolean => {
  return useSyncExternalStore(
    sessionActivityStore.subscribe,
    () => !!sessionActivityStore.getSnapshot()[tabId],
    () => !!sessionActivityStore.getSnapshot()[tabId],
  );
};

/** True if any of the given session ids currently has activity. */
export const useAnySessionActivity = (sessionIds: readonly string[]): boolean => {
  return useSyncExternalStore(
    sessionActivityStore.subscribe,
    () => {
      const snap = sessionActivityStore.getSnapshot();
      for (const id of sessionIds) {
        if (snap[id]) return true;
      }
      return false;
    },
    () => {
      const snap = sessionActivityStore.getSnapshot();
      for (const id of sessionIds) {
        if (snap[id]) return true;
      }
      return false;
    },
  );
};
