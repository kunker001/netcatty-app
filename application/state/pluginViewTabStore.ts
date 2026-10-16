import { useSyncExternalStore } from 'react';

import { activeTabStore } from './activeTabStore';

export const PLUGIN_VIEW_TAB_PREFIX = 'plugin-view:';

export interface PluginViewTab {
  id: string;
  pluginId: string;
  pluginName: string;
  viewId: string;
  title: string;
  icon?: NetcattyPluginIconReference;
  context?: Record<string, unknown>;
}

export interface ClosedPluginViewTabEvent {
  tab: PluginViewTab;
}

export function toPluginViewTabId(pluginId: string, viewId: string): string {
  return `${PLUGIN_VIEW_TAB_PREFIX}${pluginId}:${viewId}`;
}

export function isPluginViewTabId(tabId: string): boolean {
  return tabId.startsWith(PLUGIN_VIEW_TAB_PREFIX);
}

export function resolveBatchTabCloseFocus({
  orderedTabIds,
  closingTabIds,
  activeTabId,
}: {
  orderedTabIds: readonly string[];
  closingTabIds: ReadonlySet<string>;
  activeTabId: string;
}): string {
  if (!closingTabIds.has(activeTabId)) return activeTabId;
  const activeIndex = orderedTabIds.indexOf(activeTabId);
  if (activeIndex === -1) return 'vault';
  for (let distance = 1; distance < orderedTabIds.length; distance += 1) {
    const left = orderedTabIds[activeIndex - distance];
    if (left && !closingTabIds.has(left)) return left;
    const right = orderedTabIds[activeIndex + distance];
    if (right && !closingTabIds.has(right)) return right;
  }
  return 'vault';
}

export function resolvePluginViewRequest(
  requested: { viewId: string; context?: Record<string, unknown> } | null,
  activeTab: Pick<PluginViewTab, 'viewId' | 'context'> | null,
): { viewId: string; context?: Record<string, unknown> } | null {
  if (requested) return requested;
  return activeTab ? { viewId: activeTab.viewId, context: activeTab.context } : null;
}

export class PluginViewTabStore {
  private tabs: readonly PluginViewTab[] = Object.freeze([]);
  private listeners = new Set<() => void>();
  private closeListeners = new Set<(event: ClosedPluginViewTabEvent) => void>();

  constructor(private readonly activeTabs: Pick<typeof activeTabStore, 'getActiveTabId' | 'setActiveTabId'> = activeTabStore) {}

  getTabs = () => this.tabs;

  getTab(tabId: string): PluginViewTab | undefined {
    return this.tabs.find((tab) => tab.id === tabId);
  }

  open(input: Omit<PluginViewTab, 'id'>): PluginViewTab {
    const id = toPluginViewTabId(input.pluginId, input.viewId);
    const tab = Object.freeze({ ...input, id });
    const index = this.tabs.findIndex((candidate) => candidate.id === id);
    this.tabs = Object.freeze(index === -1
      ? [...this.tabs, tab]
      : this.tabs.map((candidate) => candidate.id === id ? tab : candidate));
    this.emit();
    this.activeTabs.setActiveTabId(id);
    return tab;
  }

  close(tabId: string): void {
    const closed = this.tabs.find((tab) => tab.id === tabId);
    if (!closed) return;
    const next = this.tabs.filter((tab) => tab.id !== tabId);
    this.tabs = Object.freeze(next);
    if (this.activeTabs.getActiveTabId() === tabId) this.activeTabs.setActiveTabId('vault');
    this.emit();
    this.emitClosed(closed);
  }

  retain(viewIds: ReadonlySet<string>): void {
    const next = this.tabs.filter((tab) => viewIds.has(tab.viewId));
    if (next.length === this.tabs.length) return;
    const removed = this.tabs.filter((tab) => !viewIds.has(tab.viewId));
    const activeTabId = this.activeTabs.getActiveTabId();
    this.tabs = Object.freeze(next);
    if (isPluginViewTabId(activeTabId) && !next.some((tab) => tab.id === activeTabId)) {
      this.activeTabs.setActiveTabId('vault');
    }
    this.emit();
    for (const tab of removed) this.emitClosed(tab);
  }

  refreshMetadata(entries: readonly Omit<PluginViewTab, 'id' | 'context'>[]): void {
    const metadata = new Map(entries.map((entry) => [toPluginViewTabId(entry.pluginId, entry.viewId), entry]));
    let changed = false;
    const next = this.tabs.map((tab) => {
      const entry = metadata.get(tab.id);
      if (!entry) return tab;
      if (entry.pluginName === tab.pluginName
        && entry.title === tab.title
        && JSON.stringify(entry.icon ?? null) === JSON.stringify(tab.icon ?? null)) return tab;
      changed = true;
      return Object.freeze({ ...tab, ...entry, id: tab.id });
    });
    if (!changed) return;
    this.tabs = Object.freeze(next);
    this.emit();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  onDidClose = (listener: (event: ClosedPluginViewTabEvent) => void) => {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  };

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private emitClosed(tab: PluginViewTab): void {
    const event = Object.freeze({ tab });
    for (const listener of this.closeListeners) listener(event);
  }
}

export const pluginViewTabStore = new PluginViewTabStore();

export function usePluginViewTabs(): readonly PluginViewTab[] {
  return useSyncExternalStore(pluginViewTabStore.subscribe, pluginViewTabStore.getTabs, pluginViewTabStore.getTabs);
}
