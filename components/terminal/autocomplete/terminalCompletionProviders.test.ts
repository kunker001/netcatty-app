import assert from 'node:assert/strict';
import test from 'node:test';

import type { PluginTerminalProviderRegistry } from '../../../application/state/pluginTerminalProviderRegistry.ts';
import { provideTerminalCompletions } from './terminalCompletionProviders.ts';

test('terminal completion adapter merges validated plugin results through the host Provider path', async () => {
  const calls: unknown[] = [];
  const registry = {
    async request(request: unknown) {
      calls.push(request);
      return {
        requestId: 'request-1',
        stale: false,
        results: [{
          pluginId: 'com.example',
          pluginVersion: '1.0.0',
          providerId: 'com.example.completion',
          kind: 'terminal.completion',
          requestId: 'provider-1',
          status: 'ok',
          result: {
            items: [
              { text: 'zzzzunlikely-command', displayText: 'Plugin command', score: 50_000 },
              { text: '', score: 100_000 },
            ],
          },
        }],
      } as const;
    },
  } as unknown as PluginTerminalProviderRegistry;
  const results = await provideTerminalCompletions(registry, {
    input: 'zzzzunlikely',
    session: { sessionId: 'session-1', protocol: 'ssh', status: 'connected' },
    hostOs: 'linux',
    maximum: 8,
  });
  assert.equal(calls.length, 1);
  assert.equal(results[0].text, 'zzzzunlikely-command');
  assert.equal(results[0].source, 'plugin');
  assert.equal(results[0].providerId, 'com.example.completion');
  assert.equal(results.some((item) => item.text === ''), false);
});

test('terminal completion adapter ignores stale plugin responses', async () => {
  const registry = {
    async request() { return { requestId: 'request-1', stale: true, results: [] }; },
  } as unknown as PluginTerminalProviderRegistry;
  const results = await provideTerminalCompletions(registry, {
    input: 'zzzzunlikely',
    session: { sessionId: 'session-1', protocol: 'ssh', status: 'connected' },
    hostOs: 'linux',
    maximum: 8,
  });
  assert.equal(results.some((item) => item.source === 'plugin'), false);
});

test('terminal completion adapter preserves built-in results when the plugin bridge fails', async () => {
  const registry = {
    async request() { throw new Error('bridge unavailable'); },
  } as unknown as PluginTerminalProviderRegistry;
  const results = await provideTerminalCompletions(registry, {
    input: 'zzzzunlikely',
    session: { sessionId: 'session-1', protocol: 'ssh', status: 'connected' },
    hostOs: 'linux',
    maximum: 8,
  });
  assert.ok(Array.isArray(results));
});

test('terminal completion adapter bounds plugin activation and authorization before returning built-ins', async () => {
  let signal: AbortSignal | undefined;
  const registry = {
    async request(_request: unknown, options?: { signal?: AbortSignal }) {
      signal = options?.signal;
      return new Promise(() => {});
    },
  } as unknown as PluginTerminalProviderRegistry;
  const result = await Promise.race([
    provideTerminalCompletions(registry, {
      input: 'git ',
      session: { sessionId: 'session-1', protocol: 'ssh', status: 'connected' },
      hostOs: 'linux',
      maximum: 8,
      pluginResponseTimeoutMs: 10,
    }),
    new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 250)),
  ]);
  assert.notEqual(result, 'timed-out');
  assert.ok(Array.isArray(result));
  assert.equal(signal?.aborted, true);
});

test('terminal completion adapter aborts and discards plugin results when the host security gate closes', async () => {
  let providerSignal: AbortSignal | undefined;
  let resolveProvider: ((value: {
    requestId: string;
    stale: false;
    results: readonly unknown[];
  }) => void) | undefined;
  const registry = {
    request(_request: unknown, options?: { signal?: AbortSignal }) {
      providerSignal = options?.signal;
      return new Promise((resolve) => { resolveProvider = resolve as typeof resolveProvider; });
    },
  } as unknown as PluginTerminalProviderRegistry;
  const securityController = new AbortController();
  const pending = provideTerminalCompletions(registry, {
    input: 'safe-command',
    session: { sessionId: 'session-1', protocol: 'ssh', status: 'connected' },
    hostOs: 'linux',
    maximum: 8,
    signal: securityController.signal,
  });
  await new Promise((resolve) => setImmediate(resolve));
  securityController.abort();
  resolveProvider?.({
    requestId: 'request-1',
    stale: false,
    results: [{
      providerId: 'com.example.completion',
      status: 'ok',
      result: { items: [{ text: 'plugin-result', score: 50_000 }] },
    }],
  });
  const results = await pending;
  assert.equal(providerSignal?.aborted, true);
  assert.equal(results.some((item) => item.source === 'plugin'), false);
});

test('terminal completion adapter preserves built-in snippet metadata on duplicate plugin text', async () => {
  const registry = {
    async request() {
      return {
        requestId: 'request-1',
        stale: false,
        results: [{
          pluginId: 'com.example',
          pluginVersion: '1.0.0',
          providerId: 'com.example.completion',
          kind: 'terminal.completion',
          requestId: 'provider-1',
          status: 'ok',
          result: { items: [{ text: 'deploy', score: 50_000 }] },
        }],
      } as const;
    },
  } as unknown as PluginTerminalProviderRegistry;
  const snippet = { id: 'deploy', label: 'deploy', command: 'kubectl apply -f .' };
  const results = await provideTerminalCompletions(registry, {
    input: 'dep',
    session: { sessionId: 'session-1', protocol: 'ssh', status: 'connected' },
    hostOs: 'linux',
    snippets: [snippet],
    maximum: 8,
  });
  const duplicate = results.find((item) => item.text === 'deploy');
  assert.equal(duplicate?.source, 'snippet');
  assert.equal(duplicate?.snippet, snippet);
  assert.equal(results.filter((item) => item.text === 'deploy').length, 1);
});
