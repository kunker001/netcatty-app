import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectPluginTerminalProviderKinds,
  isPluginTerminalProviderKindAvailable,
  PluginTerminalProviderAvailability,
  PluginTerminalProviderRegistry,
} from './pluginTerminalProviderRegistry.ts';

const session: NetcattyTerminalSessionSnapshot = {
  sessionId: 'session-1',
  protocol: 'ssh',
  status: 'connected',
};

test('terminal Provider availability fails closed before or after failed enumeration', async () => {
  assert.equal(isPluginTerminalProviderKindAvailable(null, 'terminal.matcher'), false);
  const registry = new PluginTerminalProviderRegistry({
    async listPluginTerminalProviders() { throw new Error('bridge unavailable'); },
    async providePluginTerminal() { return []; },
    async cancelPluginTerminalRequest() { return false; },
    async publishPluginTerminalSessionEvent() { return []; },
  });
  const kinds = await collectPluginTerminalProviderKinds(registry, [
    'terminal.matcher',
    'terminal.background',
  ]);
  assert.equal(isPluginTerminalProviderKindAvailable(kinds, 'terminal.matcher'), false);
  assert.equal(isPluginTerminalProviderKindAvailable(kinds, 'terminal.background'), false);
  registry.dispose();
});

test('terminal Provider availability ignores an older enumeration that finishes last', async () => {
  let resolveOlder: ((providers: NetcattyTerminalProviderContribution[]) => void) | undefined;
  const olderRegistry = new PluginTerminalProviderRegistry({
    listPluginTerminalProviders() {
      return new Promise((resolve) => { resolveOlder = resolve; });
    },
    async providePluginTerminal() { return []; },
    async cancelPluginTerminalRequest() { return false; },
    async publishPluginTerminalSessionEvent() { return []; },
  });
  const newerRegistry = new PluginTerminalProviderRegistry({
    async listPluginTerminalProviders() {
      return [{
        pluginId: 'com.example.matcher',
        pluginVersion: '1.0.0',
        pluginDisplayName: 'Matcher',
        provider: {
          id: 'com.example.matcher.output',
          label: 'Output matcher',
          kind: 'terminal.matcher',
        },
      }];
    },
    async providePluginTerminal() { return []; },
    async cancelPluginTerminalRequest() { return false; },
    async publishPluginTerminalSessionEvent() { return []; },
  });
  const availability = new PluginTerminalProviderAvailability();
  const older = availability.refresh(olderRegistry, ['terminal.matcher']);
  const newer = availability.refresh(newerRegistry, ['terminal.matcher']);
  assert.equal(await newer, true);
  assert.equal(availability.has('terminal.matcher'), true);
  resolveOlder?.([]);
  assert.equal(await older, false);
  assert.equal(availability.has('terminal.matcher'), true);
  olderRegistry.dispose();
  newerRegistry.dispose();
});

test('terminal Provider registry coalesces immutable enumeration until contributions change', async () => {
  let changed: (() => void) | undefined;
  let listCalls = 0;
  const resolvers: Array<(providers: NetcattyTerminalProviderContribution[]) => void> = [];
  const registry = new PluginTerminalProviderRegistry({
    listPluginTerminalProviders() {
      listCalls += 1;
      return new Promise((resolve) => { resolvers.push(resolve); });
    },
    async providePluginTerminal() { return []; },
    async cancelPluginTerminalRequest() { return false; },
    async publishPluginTerminalSessionEvent() { return []; },
    onPluginContributionsChanged(listener) {
      changed = listener;
      return () => {};
    },
  });
  const first = registry.listProviders({ kind: 'terminal.matcher' });
  const duplicate = registry.listProviders({ kind: 'terminal.matcher' });
  assert.equal(listCalls, 1);
  resolvers[0]?.([]);
  assert.strictEqual(await first, await duplicate);
  assert.strictEqual(await registry.listProviders({ kind: 'terminal.matcher' }), await first);
  assert.equal(listCalls, 1);

  changed?.();
  const refreshed = registry.listProviders({ kind: 'terminal.matcher' });
  assert.equal(listCalls, 2);
  resolvers[1]?.([]);
  await refreshed;
  registry.dispose();
});

test('terminal Provider registry suppresses repeated lifecycle RPC after the bridge is unavailable', async () => {
  let changed: (() => void) | undefined;
  let listCalls = 0;
  let lifecycleCalls = 0;
  const registry = new PluginTerminalProviderRegistry({
    async listPluginTerminalProviders() {
      listCalls += 1;
      throw new Error('PLUGIN_DEVELOPMENT_DISABLED');
    },
    async providePluginTerminal() { return []; },
    async cancelPluginTerminalRequest() { return false; },
    async publishPluginTerminalSessionEvent() {
      lifecycleCalls += 1;
      throw new Error('PLUGIN_DEVELOPMENT_DISABLED');
    },
    onPluginContributionsChanged(listener) {
      changed = listener;
      return () => {};
    },
  });

  await assert.rejects(registry.listProviders({ kind: 'terminal.link' }), /PLUGIN_DEVELOPMENT_DISABLED/);
  assert.deepEqual(await registry.listProviders({ kind: 'terminal.link' }), []);
  assert.equal(listCalls, 1);
  await registry.publishSessionEvent({ type: 'created', session });
  await registry.publishSessionEvent({ type: 'titleChanged', session: { ...session, title: 'ready' } });
  assert.equal(lifecycleCalls, 0);

  changed?.();
  await assert.rejects(
    registry.publishSessionEvent({ type: 'cwdChanged', session: { ...session, cwd: '/work' } }),
    /PLUGIN_DEVELOPMENT_DISABLED/,
  );
  await registry.publishSessionEvent({ type: 'resized', session: { ...session, cols: 80, rows: 24 } });
  assert.equal(lifecycleCalls, 1);
  registry.dispose();
});

test('terminal Provider registry cancels superseded requests and suppresses stale results', async () => {
  const cancellations: string[] = [];
  const resolvers: Array<(value: ReadonlyArray<NetcattyTerminalProviderResult>) => void> = [];
  const registry = new PluginTerminalProviderRegistry({
    async listPluginTerminalProviders() { return []; },
    providePluginTerminal() {
      return new Promise((resolve) => resolvers.push(resolve));
    },
    async cancelPluginTerminalRequest(requestId) { cancellations.push(requestId); return true; },
    async publishPluginTerminalSessionEvent() { return []; },
  });

  const first = registry.request({
    kind: 'terminal.completion',
    operation: 'provideCompletions',
    session,
    payload: { input: 'g' },
  });
  const second = registry.request({
    kind: 'terminal.completion',
    operation: 'provideCompletions',
    session,
    payload: { input: 'gi' },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancellations.length, 1);
  resolvers[1]([]);
  const secondResult = await second;
  resolvers[0]([]);
  const firstResult = await first;
  assert.equal(secondResult.stale, false);
  assert.equal(firstResult.stale, true);
  assert.deepEqual(firstResult.results, []);
});

test('terminal Provider registry aborts an in-flight bridge request and settles stale', async () => {
  const cancellations: string[] = [];
  const requests: NetcattyTerminalProviderRequest[] = [];
  const controller = new AbortController();
  const registry = new PluginTerminalProviderRegistry({
    async listPluginTerminalProviders() { return []; },
    providePluginTerminal(request) {
      requests.push(request);
      return new Promise(() => {});
    },
    async cancelPluginTerminalRequest(requestId) { cancellations.push(requestId); return true; },
    async publishPluginTerminalSessionEvent() { return []; },
  });

  const pending = registry.request({
    kind: 'terminal.completion',
    operation: 'provideCompletions',
    session,
  }, { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 1);

  controller.abort();
  const result = await pending;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result.stale, true);
  assert.deepEqual(result.results, []);
  assert.deepEqual(cancellations, [requests[0].requestId]);
  registry.dispose();
});

test('terminal Provider registry scopes link supersession per buffer line', async () => {
  const cancellations: string[] = [];
  const resolvers: Array<(value: ReadonlyArray<NetcattyTerminalProviderResult>) => void> = [];
  const registry = new PluginTerminalProviderRegistry({
    async listPluginTerminalProviders() { return []; },
    providePluginTerminal() { return new Promise((resolve) => resolvers.push(resolve)); },
    async cancelPluginTerminalRequest(requestId) { cancellations.push(requestId); return true; },
    async publishPluginTerminalSessionEvent() { return []; },
  });
  const firstLine = registry.request({
    kind: 'terminal.link',
    operation: 'provideLinks',
    session,
    supersessionKey: 'line:1',
  });
  const secondLine = registry.request({
    kind: 'terminal.link',
    operation: 'provideLinks',
    session,
    supersessionKey: 'line:2',
  });
  assert.equal(cancellations.length, 0);
  const replacementFirstLine = registry.request({
    kind: 'terminal.link',
    operation: 'provideLinks',
    session,
    supersessionKey: 'line:1',
  });
  assert.equal(cancellations.length, 1);
  resolvers[1]([]);
  resolvers[2]([]);
  assert.equal((await secondLine).stale, false);
  assert.equal((await replacementFirstLine).stale, false);
  resolvers[0]([]);
  assert.equal((await firstLine).stale, true);
});

test('terminal Provider registry returns a stale response when a superseded bridge request rejects', async () => {
  const resolvers: Array<{
    resolve: (value: ReadonlyArray<NetcattyTerminalProviderResult>) => void;
    reject: (error: Error) => void;
  }> = [];
  const registry = new PluginTerminalProviderRegistry({
    async listPluginTerminalProviders() { return []; },
    providePluginTerminal() {
      return new Promise((resolve, reject) => resolvers.push({ resolve, reject }));
    },
    async cancelPluginTerminalRequest() { return true; },
    async publishPluginTerminalSessionEvent() { return []; },
  });
  const first = registry.request({
    kind: 'terminal.decoration',
    operation: 'provideDecorations',
    session,
  });
  const second = registry.request({
    kind: 'terminal.decoration',
    operation: 'provideDecorations',
    session,
  });
  resolvers[1].resolve([]);
  assert.equal((await second).stale, false);
  resolvers[0].reject(new Error('cancelled'));
  const firstResult = await first;
  assert.equal(firstResult.stale, true);
  assert.deepEqual(firstResult.results, []);
});

test('terminal Provider registry freezes enumeration and cancels all session requests', async () => {
  const cancellations: string[] = [];
  const registry = new PluginTerminalProviderRegistry({
    async listPluginTerminalProviders() {
      return [{
        pluginId: 'com.example',
        pluginVersion: '1.0.0',
        pluginDisplayName: 'Example',
        provider: { id: 'com.example.completion', label: 'Completion', kind: 'terminal.completion' },
      }];
    },
    providePluginTerminal() { return new Promise(() => {}); },
    async cancelPluginTerminalRequest(requestId) { cancellations.push(requestId); return true; },
    async publishPluginTerminalSessionEvent() { return []; },
  });
  const providers = await registry.listProviders({ kind: 'terminal.completion' });
  assert.equal(Object.isFrozen(providers), true);
  assert.equal(Object.isFrozen(providers[0].provider), true);
  void registry.request({ kind: 'terminal.completion', operation: 'provide', session });
  void registry.request({ kind: 'terminal.decoration', operation: 'provide', session });
  registry.cancelSession(session.sessionId);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancellations.length, 2);
});

test('terminal Provider registry publishes metadata-only lifecycle snapshots', async () => {
  const events: NetcattyTerminalSessionEvent[] = [];
  const registry = new PluginTerminalProviderRegistry({
    async listPluginTerminalProviders() { return []; },
    async providePluginTerminal() { return []; },
    async cancelPluginTerminalRequest() { return false; },
    async publishPluginTerminalSessionEvent(event) { events.push(event); return []; },
  });
  await registry.publishSessionEvent({ type: 'connected', session });
  await registry.publishSessionEvent({
    type: 'cwdChanged',
    session: { sessionId: session.sessionId, protocol: 'ssh', status: 'connected', cwd: '/srv/app' },
  });
  assert.deepEqual(events, [
    { type: 'connected', session },
    { type: 'cwdChanged', session: { ...session, cwd: '/srv/app' } },
  ]);
  assert.equal(Object.isFrozen(events[0]), true);
  assert.equal(Object.isFrozen(events[0].session), true);
});

test('terminal Provider lifecycle clears optional fields instead of retaining stale metadata', async () => {
  const events: NetcattyTerminalSessionEvent[] = [];
  const requests: NetcattyTerminalProviderRequest[] = [];
  const registry = new PluginTerminalProviderRegistry({
    async listPluginTerminalProviders() { return []; },
    async providePluginTerminal(request) { requests.push(request); return []; },
    async cancelPluginTerminalRequest() { return false; },
    async publishPluginTerminalSessionEvent(event) { events.push(event); return []; },
  });
  await registry.publishSessionEvent({
    type: 'created',
    session: { ...session, cwd: '/srv/app', title: 'Application' },
  });
  await registry.publishSessionEvent({ type: 'cwdChanged', session });
  await registry.publishSessionEvent({ type: 'titleChanged', session });
  await registry.request({
    kind: 'terminal.completion',
    operation: 'provide',
    session,
  });
  assert.equal(Object.hasOwn(events[1].session, 'cwd'), false);
  assert.equal(Object.hasOwn(events[1].session, 'title'), true);
  assert.equal(Object.hasOwn(events[2].session, 'cwd'), false);
  assert.equal(Object.hasOwn(events[2].session, 'title'), false);
  assert.equal(Object.hasOwn(requests[0].session, 'cwd'), false);
  assert.equal(Object.hasOwn(requests[0].session, 'title'), false);
});

test('terminal Provider reconnect lifecycle clears omitted connection-scoped metadata', async () => {
  const events: NetcattyTerminalSessionEvent[] = [];
  const requests: NetcattyTerminalProviderRequest[] = [];
  const registry = new PluginTerminalProviderRegistry({
    async listPluginTerminalProviders() { return []; },
    async providePluginTerminal(request) { requests.push(request); return []; },
    async cancelPluginTerminalRequest() { return false; },
    async publishPluginTerminalSessionEvent(event) { events.push(event); return []; },
  });
  await registry.publishSessionEvent({
    type: 'connected',
    session: { ...session, cwd: '/srv/app', title: 'Application', alternateScreen: true },
  });
  await registry.publishSessionEvent({ type: 'disconnected', session: { ...session, status: 'disconnected' } });
  await registry.publishSessionEvent({ type: 'reconnected', session });
  await registry.request({ kind: 'terminal.completion', operation: 'provide', session });

  for (const event of events.slice(1)) {
    assert.equal(Object.hasOwn(event.session, 'cwd'), false);
    assert.equal(Object.hasOwn(event.session, 'title'), false);
    assert.equal(Object.hasOwn(event.session, 'alternateScreen'), false);
  }
  assert.equal(Object.hasOwn(requests[0].session, 'cwd'), false);
  assert.equal(Object.hasOwn(requests[0].session, 'title'), false);
  assert.equal(Object.hasOwn(requests[0].session, 'alternateScreen'), false);
});

test('terminal Provider requests merge the latest lifecycle snapshot before invocation', async () => {
  const requests: NetcattyTerminalProviderRequest[] = [];
  const registry = new PluginTerminalProviderRegistry({
    async listPluginTerminalProviders() { return []; },
    async providePluginTerminal(request) { requests.push(request); return []; },
    async cancelPluginTerminalRequest() { return false; },
    async publishPluginTerminalSessionEvent() { return []; },
  });
  await registry.publishSessionEvent({
    type: 'created',
    session: { ...session, workspaceId: 'workspace-1', title: 'Initial title', cols: 100, rows: 30 },
  });
  await registry.request({
    kind: 'terminal.completion',
    operation: 'provide',
    session: { ...session, cwd: '/srv/app' },
  });
  assert.deepEqual(requests[0].session, {
    ...session,
    workspaceId: 'workspace-1',
    title: 'Initial title',
    cols: 100,
    rows: 30,
    cwd: '/srv/app',
  });
  assert.equal(Object.isFrozen(requests[0].session), true);
});

test('terminal Provider registry forwards contribution lifecycle invalidation', () => {
  let bridgeListener: (() => void) | undefined;
  let disposed = false;
  const cancellations: string[] = [];
  const registry = new PluginTerminalProviderRegistry({
    async listPluginTerminalProviders() { return []; },
    async providePluginTerminal() { return []; },
    async cancelPluginTerminalRequest(requestId) { cancellations.push(requestId); return true; },
    async publishPluginTerminalSessionEvent() { return []; },
    onPluginContributionsChanged(listener) {
      bridgeListener = listener;
      return () => { disposed = true; };
    },
  });
  let changes = 0;
  const unsubscribe = registry.onDidChangeProviders(() => { changes += 1; });
  void registry.request({ kind: 'terminal.completion', operation: 'provide', session });
  bridgeListener?.();
  assert.equal(changes, 1);
  assert.equal(cancellations.length, 1);
  unsubscribe();
  bridgeListener?.();
  assert.equal(changes, 1);
  registry.dispose();
  assert.equal(disposed, true);
});
