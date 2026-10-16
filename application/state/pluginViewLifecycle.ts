export interface HostedPluginViewState {
  id: string;
  viewId: string;
  scopeId: string;
  retainContextWhenHidden: boolean;
  tabId?: string;
}

export interface PluginViewSnapshotSelection<T> {
  requestViewId: string;
  contextKey: string;
  value: T;
}

export interface PluginViewTabCatalogEntry {
  pluginId: string;
  pluginName: string;
  viewId: string;
  title: string;
  icon?: NetcattyPluginIconReference;
}

export interface PluginViewTabCatalogStore {
  retain(viewIds: ReadonlySet<string>): void;
  refreshMetadata(entries: readonly PluginViewTabCatalogEntry[]): void;
}

export function resolvePluginViewSnapshotSelection<T>({
  resolved,
  previous,
  loading,
  requestedViewId,
  contextKey,
}: {
  resolved: T | null;
  previous: PluginViewSnapshotSelection<T> | null;
  loading: boolean;
  requestedViewId: string | undefined;
  contextKey: string;
}): T | null {
  if (resolved) return resolved;
  if (!loading || !previous || previous.requestViewId !== requestedViewId
    || previous.contextKey !== contextKey) return null;
  return previous.value;
}

export function shouldReconcilePluginViewTabCatalog({
  loading,
}: {
  loading: boolean;
}): boolean {
  return !loading;
}

export function collectPluginViewTabCatalog(
  plugins: NetcattyPluginContributionSnapshot['plugins'],
): PluginViewTabCatalogEntry[] {
  return plugins.flatMap((plugin) => plugin.views
    .filter((view) => view.location === 'tab')
    .map((view) => ({
      pluginId: plugin.id,
      pluginName: plugin.displayName,
      viewId: view.id,
      title: view.title,
      icon: view.icon,
    })));
}

export function reconcilePluginViewTabCatalog({
  loading,
  plugins,
  store,
}: {
  loading: boolean;
  plugins: NetcattyPluginContributionSnapshot['plugins'];
  store: PluginViewTabCatalogStore;
}): boolean {
  if (!shouldReconcilePluginViewTabCatalog({ loading })) return false;
  const entries = collectPluginViewTabCatalog(plugins);
  store.retain(new Set(entries.map((entry) => entry.viewId)));
  store.refreshMetadata(entries);
  return true;
}

export function reconcileClosedPluginView<T extends HostedPluginViewState>({
  current,
  retained,
  instanceId,
}: {
  current: T | null;
  retained: ReadonlyMap<string, T>;
  instanceId: string;
}): {
  current: T | null;
  retained: Map<string, T>;
  matchedCurrent: boolean;
  matchedRetained: boolean;
  closedTabId?: string;
} {
  const matchedCurrent = current?.id === instanceId;
  let matchedRetained = false;
  let retainedTabId: string | undefined;
  const nextRetained = new Map<string, T>();
  for (const [key, view] of retained) {
    if (view.id === instanceId) {
      matchedRetained = true;
      retainedTabId = view.tabId;
    }
    else nextRetained.set(key, view);
  }
  return {
    current: matchedCurrent ? null : current,
    retained: nextRetained,
    matchedCurrent,
    matchedRetained,
    ...((matchedCurrent ? current?.tabId : retainedTabId)
      ? { closedTabId: matchedCurrent ? current?.tabId : retainedTabId }
      : {}),
  };
}

export function withdrawPluginViewTab<T extends HostedPluginViewState>({
  current,
  retained,
  tabId,
}: {
  current: T | null;
  retained: ReadonlyMap<string, T>;
  tabId: string;
}): {
  current: T | null;
  retained: Map<string, T>;
  instanceIds: string[];
  matchedCurrent: boolean;
  matchedRetained: boolean;
} {
  const matchedCurrent = current?.tabId === tabId;
  let matchedRetained = false;
  const instanceIds: string[] = [];
  if (matchedCurrent && current) instanceIds.push(current.id);
  const nextRetained = new Map<string, T>();
  for (const [key, view] of retained) {
    if (view.tabId === tabId) {
      matchedRetained = true;
      instanceIds.push(view.id);
    } else {
      nextRetained.set(key, view);
    }
  }
  return {
    current: matchedCurrent ? null : current,
    retained: nextRetained,
    instanceIds,
    matchedCurrent,
    matchedRetained,
  };
}

export function rememberClosedPluginViewInstance(
  tombstones: Set<string>,
  instanceId: string,
  limit = 256,
): void {
  if (tombstones.size >= limit) {
    const oldest = tombstones.values().next().value;
    if (typeof oldest === 'string') tombstones.delete(oldest);
  }
  tombstones.add(instanceId);
}

export function consumeClosedPluginViewInstance(tombstones: Set<string>, instanceId: string): boolean {
  return tombstones.delete(instanceId);
}

export function markPluginViewOpenTokensClosed(
  openingTokens: ReadonlyMap<string, ReadonlySet<symbol>>,
  explicitlyClosedTokens: Set<symbol>,
  ownerKey: string | null | undefined,
): number {
  if (!ownerKey) return 0;
  const tokens = openingTokens.get(ownerKey);
  if (!tokens) return 0;
  for (const token of tokens) explicitlyClosedTokens.add(token);
  return tokens.size;
}

export class PluginViewLifecycleController<T extends HostedPluginViewState = HostedPluginViewState> {
  private current: T | null = null;
  private retained = new Map<string, T>();
  private readonly closedInstanceIds = new Set<string>();
  private readonly openingTokensByTab = new Map<string, Set<symbol>>();
  private readonly openingTokensByView = new Map<string, Set<symbol>>();
  private readonly explicitlyClosedOpenTokens = new Set<symbol>();

  getCurrent(): T | null {
    return this.current;
  }

  setCurrent(view: T | null): void {
    this.current = view;
  }

  takeCurrent(): T | null {
    const current = this.current;
    this.current = null;
    return current;
  }

  retain(key: string, view: T): void {
    this.retained.set(key, view);
  }

  takeRetained(key: string): T | null {
    const retained = this.retained.get(key) ?? null;
    if (retained) this.retained.delete(key);
    return retained;
  }

  removeRetained(key: string): void {
    this.retained.delete(key);
  }

  removeRetainedWhere(predicate: (view: T) => boolean): T[] {
    const removed: T[] = [];
    for (const [key, view] of this.retained) {
      if (!predicate(view)) continue;
      this.retained.delete(key);
      removed.push(view);
    }
    return removed;
  }

  handleHostClose(instanceId: string) {
    const next = reconcileClosedPluginView({
      current: this.current,
      retained: this.retained,
      instanceId,
    });
    this.current = next.current;
    this.retained = next.retained;
    if (!next.matchedCurrent && !next.matchedRetained) {
      rememberClosedPluginViewInstance(this.closedInstanceIds, instanceId);
    }
    return next;
  }

  handleTabClose(tabId: string) {
    const next = withdrawPluginViewTab({
      current: this.current,
      retained: this.retained,
      tabId,
    });
    this.current = next.current;
    this.retained = next.retained;
    markPluginViewOpenTokensClosed(
      this.openingTokensByTab,
      this.explicitlyClosedOpenTokens,
      tabId,
    );
    return next;
  }

  markViewClosed(viewKey: string | null | undefined): number {
    return markPluginViewOpenTokensClosed(
      this.openingTokensByView,
      this.explicitlyClosedOpenTokens,
      viewKey,
    );
  }

  beginOpen({
    viewKey,
    tabId,
    label,
  }: {
    viewKey: string;
    tabId?: string;
    label?: string;
  }): symbol {
    const token = Symbol(label ?? tabId ?? viewKey);
    const viewTokens = this.openingTokensByView.get(viewKey) ?? new Set<symbol>();
    viewTokens.add(token);
    this.openingTokensByView.set(viewKey, viewTokens);
    if (tabId) {
      const tabTokens = this.openingTokensByTab.get(tabId) ?? new Set<symbol>();
      tabTokens.add(token);
      this.openingTokensByTab.set(tabId, tabTokens);
    }
    return token;
  }

  finishOpen({ token, viewKey, tabId }: { token: symbol; viewKey: string; tabId?: string }): void {
    this.explicitlyClosedOpenTokens.delete(token);
    const viewTokens = this.openingTokensByView.get(viewKey);
    viewTokens?.delete(token);
    if (viewTokens?.size === 0) this.openingTokensByView.delete(viewKey);
    if (!tabId) return;
    const tabTokens = this.openingTokensByTab.get(tabId);
    tabTokens?.delete(token);
    if (tabTokens?.size === 0) this.openingTokensByTab.delete(tabId);
  }

  shouldCloseOpen(token: symbol): boolean {
    return this.explicitlyClosedOpenTokens.has(token);
  }

  consumeHostClose(instanceId: string): boolean {
    return consumeClosedPluginViewInstance(this.closedInstanceIds, instanceId);
  }

  drain(): T[] {
    const values = [this.current, ...this.retained.values()].filter((view): view is T => Boolean(view));
    this.current = null;
    this.retained.clear();
    this.closedInstanceIds.clear();
    this.openingTokensByTab.clear();
    this.openingTokensByView.clear();
    this.explicitlyClosedOpenTokens.clear();
    return values;
  }
}
