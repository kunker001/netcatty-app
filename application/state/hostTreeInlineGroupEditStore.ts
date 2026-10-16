import { useSyncExternalStore } from 'react';

export type HostTreeInlineGroupEdit = {
  groupPath: string;
  initialName: string;
  isNew: boolean;
  shouldScrollIntoView?: boolean;
};

type Listener = () => void;

class HostTreeInlineGroupEditStore {
  private edit: HostTreeInlineGroupEdit | null = null;
  private listeners = new Set<Listener>();

  getEdit = () => this.edit;

  startEdit = (edit: HostTreeInlineGroupEdit) => {
    this.edit = {
      ...edit,
      shouldScrollIntoView: edit.isNew ? true : edit.shouldScrollIntoView,
    };
    this.listeners.forEach((listener) => listener());
  };

  markScrollHandled = () => {
    if (!this.edit?.shouldScrollIntoView) return;
    this.edit = { ...this.edit, shouldScrollIntoView: false };
    this.listeners.forEach((listener) => listener());
  };

  clear = () => {
    if (!this.edit) return;
    this.edit = null;
    this.listeners.forEach((listener) => listener());
  };

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export const hostTreeInlineGroupEditStore = new HostTreeInlineGroupEditStore();

export const useHostTreeInlineGroupEdit = () => {
  return useSyncExternalStore(
    hostTreeInlineGroupEditStore.subscribe,
    hostTreeInlineGroupEditStore.getEdit,
    hostTreeInlineGroupEditStore.getEdit,
  );
};
