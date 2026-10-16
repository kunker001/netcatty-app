import { useSyncExternalStore } from 'react';

type Listener = () => void;

class HostTreeInlineGroupDeleteStore {
  private targetPath: string | null = null;
  private listeners = new Set<Listener>();

  getTargetPath = () => this.targetPath;

  open = (groupPath: string) => {
    this.targetPath = groupPath;
    this.listeners.forEach((listener) => listener());
  };

  close = () => {
    if (!this.targetPath) return;
    this.targetPath = null;
    this.listeners.forEach((listener) => listener());
  };

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export const hostTreeInlineGroupDeleteStore = new HostTreeInlineGroupDeleteStore();

export const useHostTreeInlineGroupDeleteTarget = () => {
  return useSyncExternalStore(
    hostTreeInlineGroupDeleteStore.subscribe,
    hostTreeInlineGroupDeleteStore.getTargetPath,
    hostTreeInlineGroupDeleteStore.getTargetPath,
  );
};
