import { useSyncExternalStore } from 'react';

type Listener = () => void;

export type AppearanceChromeSnapshot = {
  accentMode: 'theme' | 'custom';
  customAccent: string;
};

const DEFAULT_SNAPSHOT: AppearanceChromeSnapshot = Object.freeze({
  accentMode: 'theme',
  customAccent: '',
});

/**
 * External store for app accent chrome so Terminal leaves can apply custom
 * accent without TerminalLayer rebuilding on every color-picker drag tick.
 */
class AppearanceChromeStore {
  private snapshot: AppearanceChromeSnapshot = DEFAULT_SNAPSHOT;
  private listeners = new Set<Listener>();

  getSnapshot = (): AppearanceChromeSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  setSnapshot(next: AppearanceChromeSnapshot): void {
    if (
      this.snapshot.accentMode === next.accentMode
      && this.snapshot.customAccent === next.customAccent
    ) {
      return;
    }
    this.snapshot = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const appearanceChromeStore = new AppearanceChromeStore();

export function publishAppearanceChromeSnapshot(
  snapshot: AppearanceChromeSnapshot,
): void {
  appearanceChromeStore.setSnapshot(snapshot);
}

export function getAppearanceChromeSnapshot(): AppearanceChromeSnapshot {
  return appearanceChromeStore.getSnapshot();
}

export function subscribeAppearanceChrome(listener: Listener): () => void {
  return appearanceChromeStore.subscribe(listener);
}

export function useAppearanceChromeStore(): AppearanceChromeSnapshot {
  return useSyncExternalStore(
    subscribeAppearanceChrome,
    getAppearanceChromeSnapshot,
    getAppearanceChromeSnapshot,
  );
}
