import assert from 'node:assert/strict';
import test from 'node:test';

import { PluginTerminalVisualProviderHost } from './pluginTerminalVisualProviderHost.ts';

test('visual Provider host renders bounded matcher, semantic, prompt, and background output', async () => {
  const renderedElements: Array<Record<string, unknown>> = [];
  const decorationOptions: unknown[] = [];
  const rootChildren: Array<{ remove(): void }> = [];
  let onWriteParsed: (() => void) | undefined;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement() {
        const attributes = new Map<string, string>();
        const element = {
          className: '',
          textContent: '',
          title: '',
          style: {} as Record<string, string>,
          setAttribute(name: string, value: string) { attributes.set(name, value); },
          remove() {
            const index = rootChildren.indexOf(element);
            if (index >= 0) rootChildren.splice(index, 1);
          },
        };
        return element;
      },
    },
  });
  try {
    const term = {
      element: {
        appendChild(element: { remove(): void }) { rootChildren.push(element); },
      },
      buffer: {
        active: {
          type: 'normal',
          baseY: 0,
          cursorY: 2,
          cursorX: 6,
          getLine(line: number) {
            if (line === 0) return { isWrapped: false, translateToString(trim: boolean) { return trim ? 'fail' : 'fail'; } };
            if (line === 1) return { isWrapped: true, translateToString() { return 'ed'; } };
            if (line === 2) return { isWrapped: false, translateToString() { return 'host$  '; } };
            return undefined;
          },
        },
      },
      onWriteParsed(listener: () => void) {
        onWriteParsed = listener;
        return { dispose() {} };
      },
      registerMarker() {
        return { dispose() {} };
      },
      registerDecoration(options: unknown) {
        decorationOptions.push(options);
        return {
          dispose() {},
          onRender(listener: (element: Record<string, unknown>) => void) {
            const element = {
              className: '',
              textContent: '',
              title: '',
              style: {},
              setAttribute() {},
            };
            renderedElements.push(element);
            listener(element);
            return { dispose() {} };
          },
        };
      },
    };
    const kinds: string[] = [];
    const matcherPayloads: unknown[] = [];
    const promptPayloads: unknown[] = [];
    const host = new PluginTerminalVisualProviderHost({
      term: term as never,
      matcherQuietMs: 1,
      async request(kind, _operation, payload) {
        kinds.push(kind);
        if (kind === 'terminal.semantic') {
          return {
            stale: false,
            results: [{ providerId: 'semantic', status: 'ok', result: {
              classification: 'deployment',
              destructive: true,
              annotations: [{ text: 'production', color: '#ff0000' }],
            } }],
          };
        }
        if (kind === 'terminal.prompt') {
          promptPayloads.push(payload);
          return {
            stale: false,
            results: [{ providerId: 'prompt', status: 'ok', result: {
              annotations: [{ text: 'venv', color: '#00ff00' }],
            } }],
          };
        }
        if (kind === 'terminal.matcher') {
          matcherPayloads.push(payload);
          return {
            stale: false,
            results: [{ providerId: 'matcher', status: 'ok', result: {
              matches: [{ lineId: '0:1', start: 0, length: 6, label: 'Failure', severity: 'error' }],
            } }],
          };
        }
        return {
          stale: false,
          results: [{ providerId: 'background', status: 'ok', result: {
            layers: [{ id: 'tint', color: '#102030', opacity: 0.2 }],
          } }],
        };
      },
    });

    await host.commandSubmitted('deploy');
    await host.commandCompleted();
    onWriteParsed?.();
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.deepEqual(kinds.sort(), [
      'terminal.background',
      'terminal.matcher',
      'terminal.prompt',
      'terminal.semantic',
    ]);
    assert.equal(rootChildren.length, 1);
    assert.deepEqual(matcherPayloads, [{
      lines: [
        { lineId: '0:1', line: 'failed', bufferLineNumber: 1 },
        { lineId: '2:2', line: 'host$  ', bufferLineNumber: 3 },
      ],
    }]);
    assert.deepEqual(promptPayloads, [{
      reason: 'commandCompleted',
      promptLine: 'host$',
      bufferLineNumber: 3,
    }]);
    assert.equal(decorationOptions.length, 3);
    assert.equal(renderedElements.filter((element) => element.title === 'Failure').length, 2);
    assert.equal(renderedElements.some((element) => (
      element.textContent === '[destructive] deployment | production | venv'
    )), true);
    assert.equal(renderedElements.some((element) => element.title === 'Failure'), true);

    host.setActive(false);
    assert.equal(rootChildren.length, 0);
    host.dispose();
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('visual Provider host preserves semantics when command completion wins the Provider race', async () => {
  let resolveSemantic: ((value: {
    stale: boolean;
    results: Array<{ providerId: string; status: string; result: unknown }>;
  }) => void) | undefined;
  const renderedText: string[] = [];
  const term = {
    element: null,
    buffer: { active: { type: 'normal', baseY: 0, cursorY: 0, getLine() { return undefined; } } },
    onWriteParsed() { return { dispose() {} }; },
    registerMarker() { return { dispose() {} }; },
    registerDecoration() {
      return {
        dispose() {},
        onRender(listener: (element: Record<string, unknown>) => void) {
          const element = {
            className: '',
            textContent: '',
            title: '',
            style: {},
            setAttribute() {},
          };
          listener(element);
          renderedText.push(String(element.textContent));
          return { dispose() {} };
        },
      };
    },
  };
  const host = new PluginTerminalVisualProviderHost({
    term: term as never,
    isProviderAvailable: (kind) => kind === 'terminal.semantic',
    request() {
      return new Promise((resolve) => { resolveSemantic = resolve; });
    },
  });
  const submitted = host.commandSubmitted('true');
  const completed = host.commandCompleted();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(renderedText, []);
  resolveSemantic?.({
    stale: false,
    results: [{
      providerId: 'semantic',
      status: 'ok',
      result: { classification: 'success', annotations: [{ text: 'fast command' }] },
    }],
  });
  await Promise.all([submitted, completed]);
  assert.deepEqual(renderedText, ['success | fast command']);
  host.dispose();
});

test('visual Provider host restores annotations after terminal history is rebuilt', async () => {
  const markers: Array<{ line: number; isDisposed: boolean; dispose(): void }> = [];
  const renderedText: string[] = [];
  const term = {
    element: null,
    buffer: { active: { type: 'normal', baseY: 4, cursorY: 2, cursorX: 0, getLine() { return undefined; } } },
    onWriteParsed() { return { dispose() {} }; },
    registerMarker(offset: number) {
      const marker = {
        line: 6 + offset,
        isDisposed: false,
        dispose() { this.isDisposed = true; this.line = -1; },
      };
      markers.push(marker);
      return marker;
    },
    registerDecoration() {
      return {
        dispose() {},
        onRender(listener: (element: Record<string, unknown>) => void) {
          const element = {
            className: '',
            textContent: '',
            title: '',
            style: {},
            setAttribute() {},
          };
          listener(element);
          renderedText.push(String(element.textContent));
          return { dispose() {} };
        },
      };
    },
  };
  const host = new PluginTerminalVisualProviderHost({
    term: term as never,
    isProviderAvailable: (kind) => kind === 'terminal.semantic',
    async request() {
      return {
        stale: false,
        results: [{ providerId: 'semantic', status: 'ok', result: {
          classification: 'success',
          annotations: [{ text: 'retained annotation' }],
        } }],
      };
    },
  });

  await host.commandSubmitted('true');
  await host.commandCompleted();
  assert.deepEqual(renderedText, ['success | retained annotation']);
  markers[0].dispose();

  host.terminalRebuilt();
  assert.deepEqual(renderedText, [
    'success | retained annotation',
    'success | retained annotation',
  ]);
  assert.equal(markers[1].line, 6);
  host.dispose();
});

test('visual Provider host preserves semantic queue order at its bounded capacity', async () => {
  let requests = 0;
  const renderedText: string[] = [];
  const term = {
    element: null,
    buffer: { active: { type: 'normal', baseY: 0, cursorY: 0, cursorX: 0, getLine() { return undefined; } } },
    onWriteParsed() { return { dispose() {} }; },
    registerMarker() { return { dispose() {} }; },
    registerDecoration() {
      return {
        dispose() {},
        onRender(listener: (element: Record<string, unknown>) => void) {
          const element = { className: '', textContent: '', title: '', style: {}, setAttribute() {} };
          listener(element);
          renderedText.push(String(element.textContent));
          return { dispose() {} };
        },
      };
    },
  };
  const host = new PluginTerminalVisualProviderHost({
    term: term as never,
    isProviderAvailable: (kind) => kind === 'terminal.semantic',
    async request() {
      const index = requests++;
      return {
        stale: false,
        results: [{ providerId: 'semantic', status: 'ok', result: { classification: `command-${index}` } }],
      };
    },
  });
  await Promise.all(Array.from({ length: 65 }, (_, index) => host.commandSubmitted(`echo ${index}`)));
  assert.equal(requests, 64);
  await host.commandCompleted();
  assert.deepEqual(renderedText, ['command-0']);
  host.dispose();
});

test('visual Provider host never labels the last output line as a shell prompt', async () => {
  const promptPayloads: unknown[] = [];
  const term = {
    element: null,
    buffer: {
      active: {
        type: 'normal',
        baseY: 0,
        cursorY: 0,
        cursorX: 14,
        getLine() {
          return { isWrapped: false, translateToString() { return 'command failed'; } };
        },
      },
    },
    onWriteParsed() { return { dispose() {} }; },
    registerMarker() { return null; },
    registerDecoration() { return undefined; },
  };
  const host = new PluginTerminalVisualProviderHost({
    term: term as never,
    isProviderAvailable: (kind) => kind === 'terminal.prompt',
    async request(_kind, _operation, payload) {
      promptPayloads.push(payload);
      return { stale: false, results: [] };
    },
  });
  await host.commandCompleted();
  assert.deepEqual(promptPayloads, [{ reason: 'commandCompleted' }]);
  host.dispose();
});

test('visual Provider host bounds activation and permission waits end to end', async () => {
  const signals: AbortSignal[] = [];
  const term = {
    element: null,
    buffer: {
      active: {
        type: 'normal',
        baseY: 0,
        cursorY: 0,
        getLine() { return { translateToString() { return 'failed'; } }; },
      },
    },
    onWriteParsed() { return { dispose() {} }; },
    registerMarker() { return null; },
    registerDecoration() { return undefined; },
  };
  const host = new PluginTerminalVisualProviderHost({
    term: term as never,
    providerResponseTimeoutMs: 5,
    async request(_kind, _operation, _payload, _deadlineMs, _supersessionKey, signal) {
      if (signal) signals.push(signal);
      return new Promise(() => {});
    },
  });
  const result = await Promise.race([
    host.commandSubmitted('deploy').then(() => 'completed'),
    new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 100)),
  ]);
  assert.equal(result, 'completed');
  assert.equal(signals.length, 2);
  assert.equal(signals.every((signal) => signal.aborted), true);
  host.dispose();
});

test('visual Provider background refresh pauses while hidden and under reduced motion', async () => {
  let requests = 0;
  const term = {
    element: null,
    buffer: {
      active: {
        type: 'normal',
        baseY: 0,
        cursorY: 0,
        getLine() { return { translateToString() { return 'prompt'; } }; },
      },
    },
    onWriteParsed() { return { dispose() {} }; },
    registerMarker() { return null; },
    registerDecoration() { return undefined; },
  };
  const host = new PluginTerminalVisualProviderHost({
    term: term as never,
    reducedMotion: true,
    async request(kind) {
      if (kind === 'terminal.background') requests += 1;
      return {
        stale: false,
        results: [{ providerId: 'background', status: 'ok', result: {
          layers: [],
          refreshAfterMs: 250,
        } }],
      };
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 1);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(requests, 1);
  host.setVisible(false);
  await host.refreshBackground('hidden');
  assert.equal(requests, 1);
  host.setVisible(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 2);
  host.dispose();
});

test('visual Provider host aborts and invalidates in-flight visual requests when hidden', async () => {
  let onWriteParsed: (() => void) | undefined;
  let resolveBackground: ((value: {
    stale: false;
    results: Array<{ providerId: string; status: 'ok'; result: unknown }>;
  }) => void) | undefined;
  let resolveMatcher: typeof resolveBackground;
  const signals = new Map<string, AbortSignal>();
  const rootChildren: Array<{ remove(): void }> = [];
  let decorations = 0;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement() {
        const element = {
          className: '',
          style: {} as Record<string, string>,
          setAttribute() {},
          remove() {
            const index = rootChildren.indexOf(element);
            if (index >= 0) rootChildren.splice(index, 1);
          },
        };
        return element;
      },
    },
  });
  try {
    const term = {
      element: { appendChild(element: { remove(): void }) { rootChildren.push(element); } },
      buffer: {
        active: {
          type: 'normal',
          baseY: 0,
          cursorY: 0,
          cursorX: 6,
          getLine(line: number) {
            if (line !== 0) return undefined;
            return { isWrapped: false, translateToString() { return 'failed'; } };
          },
        },
      },
      onWriteParsed(listener: () => void) { onWriteParsed = listener; return { dispose() {} }; },
      registerMarker() { return { dispose() {} }; },
      registerDecoration() { decorations += 1; return { dispose() {}, onRender() {} }; },
    };
    const host = new PluginTerminalVisualProviderHost({
      term: term as never,
      matcherQuietMs: 1,
      request(kind, _operation, _payload, _deadlineMs, _supersessionKey, signal) {
        if (signal) signals.set(kind, signal);
        return new Promise((resolve) => {
          if (kind === 'terminal.background') resolveBackground = resolve;
          if (kind === 'terminal.matcher') resolveMatcher = resolve;
        });
      },
    });
    onWriteParsed?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual([...signals.keys()].sort(), ['terminal.background', 'terminal.matcher']);

    host.setVisible(false);
    assert.equal(signals.get('terminal.background')?.aborted, true);
    assert.equal(signals.get('terminal.matcher')?.aborted, true);

    resolveBackground?.({
      stale: false,
      results: [{ providerId: 'background', status: 'ok', result: {
        layers: [{ id: 'late', color: '#102030', opacity: 0.2 }],
        refreshAfterMs: 250,
      } }],
    });
    resolveMatcher?.({
      stale: false,
      results: [{ providerId: 'matcher', status: 'ok', result: {
        matches: [{ lineId: '0:0', start: 0, length: 6, label: 'Late' }],
      } }],
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(rootChildren.length, 0);
    assert.equal(decorations, 0);
    const requestCount = signals.size;
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(signals.size, requestCount);
    host.dispose();
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('visual Provider host keeps the terminal output hot path idle without declared Providers', async () => {
  let onWriteParsed: (() => void) | undefined;
  let requests = 0;
  const term = {
    element: null,
    buffer: {
      active: {
        type: 'normal',
        baseY: 0,
        cursorY: 0,
        getLine() { return { translateToString() { return 'output'; } }; },
      },
    },
    onWriteParsed(listener: () => void) {
      onWriteParsed = listener;
      return { dispose() {} };
    },
    registerMarker() { return null; },
    registerDecoration() { return undefined; },
  };
  const host = new PluginTerminalVisualProviderHost({
    term: term as never,
    matcherQuietMs: 1,
    isProviderAvailable: () => false,
    async request() { requests += 1; return { stale: false, results: [] }; },
  });
  onWriteParsed?.();
  await host.commandSubmitted('deploy');
  await host.commandCompleted();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(requests, 0);
  host.dispose();
});

test('visual Provider host discards normal-buffer matcher results after alternate-screen entry', async () => {
  let onWriteParsed: (() => void) | undefined;
  let resolveMatcher: ((value: {
    stale: boolean;
    results: Array<{ providerId: string; status: string; result: unknown }>;
  }) => void) | undefined;
  let decorations = 0;
  const active = {
    type: 'normal',
    baseY: 0,
    cursorY: 0,
    getLine() {
      return { isWrapped: false, translateToString() { return 'failed'; } };
    },
  };
  const term = {
    element: null,
    buffer: { active },
    onWriteParsed(listener: () => void) {
      onWriteParsed = listener;
      return { dispose() {} };
    },
    registerMarker() { return { dispose() {} }; },
    registerDecoration() { decorations += 1; return { dispose() {}, onRender() {} }; },
  };
  const host = new PluginTerminalVisualProviderHost({
    term: term as never,
    matcherQuietMs: 1,
    isProviderAvailable: (kind) => kind === 'terminal.matcher',
    request() { return new Promise((resolve) => { resolveMatcher = resolve; }); },
  });
  onWriteParsed?.();
  await new Promise((resolve) => setTimeout(resolve, 10));
  active.type = 'alternate';
  resolveMatcher?.({
    stale: false,
    results: [{
      providerId: 'matcher',
      status: 'ok',
      result: { matches: [{ lineId: '0:0', start: 0, length: 6, label: 'Failure' }] },
    }],
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(decorations, 0);
  host.dispose();
});

test('visual Provider host invalidates an in-flight matcher immediately when output changes', async () => {
  let onWriteParsed: (() => void) | undefined;
  let matcherSignal: AbortSignal | undefined;
  let decorations = 0;
  let lineText = 'failed';
  const term = {
    element: null,
    buffer: {
      active: {
        type: 'normal',
        baseY: 0,
        cursorY: 0,
        getLine() { return { isWrapped: false, translateToString() { return lineText; } }; },
      },
    },
    onWriteParsed(listener: () => void) { onWriteParsed = listener; return { dispose() {} }; },
    registerMarker() { return { dispose() {} }; },
    registerDecoration() { decorations += 1; return { dispose() {}, onRender() {} }; },
  };
  const host = new PluginTerminalVisualProviderHost({
    term: term as never,
    matcherQuietMs: 1,
    isProviderAvailable: (kind) => kind === 'terminal.matcher',
    request(_kind, _operation, _payload, _deadlineMs, _supersessionKey, signal) {
      matcherSignal = signal;
      return new Promise((resolve) => {
        signal?.addEventListener('abort', () => resolve({ stale: true, results: [] }), { once: true });
      });
    },
  });
  onWriteParsed?.();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(matcherSignal?.aborted, false);

  lineText = 'new output';
  onWriteParsed?.();
  assert.equal(matcherSignal?.aborted, true);
  assert.equal(decorations, 0);
  host.dispose();
});

test('visual Provider host reacts to reduced-motion preference changes', async () => {
  let listener: ((event: { matches: boolean }) => void) | undefined;
  let removed = false;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      matchMedia() {
        return {
          matches: false,
          addEventListener(_type: string, next: typeof listener) { listener = next; },
          removeEventListener() { removed = true; },
        };
      },
    },
  });
  try {
    let requests = 0;
    const term = {
      element: null,
      buffer: { active: { type: 'normal', baseY: 0, cursorY: 0, getLine() { return undefined; } } },
      onWriteParsed() { return { dispose() {} }; },
      registerMarker() { return null; },
      registerDecoration() { return undefined; },
    };
    const host = new PluginTerminalVisualProviderHost({
      term: term as never,
      async request(kind) {
        if (kind === 'terminal.background') requests += 1;
        return {
          stale: false,
          results: [{ providerId: 'background', status: 'ok', result: {
            layers: [],
            refreshAfterMs: 250,
          } }],
        };
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests, 1);
    listener?.({ matches: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(requests, 1);
    listener?.({ matches: false });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests, 2);
    host.dispose();
    assert.equal(removed, true);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('visual Provider host does not expose a truncated wrapped logical-line suffix', async () => {
  let onWriteParsed: (() => void) | undefined;
  const matcherPayloads: Array<{ lines?: unknown[] }> = [];
  const term = {
    element: null,
    buffer: {
      active: {
        type: 'normal',
        baseY: 0,
        cursorY: 256,
        getLine(line: number) {
          if (line < 256) {
            return { isWrapped: true, translateToString() { return 'x'; } };
          }
          if (line === 256) {
            return { isWrapped: false, translateToString() { return 'prompt'; } };
          }
          return undefined;
        },
      },
    },
    onWriteParsed(next: () => void) { onWriteParsed = next; return { dispose() {} }; },
    registerMarker() { return null; },
    registerDecoration() { return undefined; },
  };
  const host = new PluginTerminalVisualProviderHost({
    term: term as never,
    matcherQuietMs: 1,
    isProviderAvailable: (kind) => kind === 'terminal.matcher',
    async request(kind, _operation, payload) {
      if (kind === 'terminal.matcher') matcherPayloads.push(payload);
      return { stale: false, results: [] };
    },
  });
  onWriteParsed?.();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(matcherPayloads, [{
    lines: [{ lineId: '256:256', line: 'prompt', bufferLineNumber: 257 }],
  }]);
  host.dispose();
});
