"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { RPC_ERRORS, PluginRpcError } = require("./rpcRouter.cjs");
const {
  MAX_TERMINAL_PROVIDERS_PER_REQUEST,
  PluginTerminalProviderService,
  normalizeTerminalSessionEvent,
} = require("./terminalProviderService.cjs");

function provider(pluginId, id, kind) {
  return {
    pluginId,
    pluginVersion: "1.0.0",
    pluginDisplayName: pluginId,
    provider: { id, kind, label: id },
  };
}

function setup(options = {}) {
  const providers = options.providers ?? [
    provider("com.example.beta", "com.example.beta.completion", "terminal.completion"),
    provider("com.example.alpha", "com.example.alpha.completion", "terminal.completion"),
    provider("com.example.alpha", "com.example.alpha.decoration", "terminal.decoration"),
    provider("com.example.alpha", "com.example.alpha.interceptor", "terminal.interceptor.input"),
  ];
  const calls = [];
  const notifications = [];
  const permissionCalls = [];
  const active = new Set(options.activePluginIds ?? []);
  let contributionListener = null;
  const contributionService = {
    listProviders({ kind } = {}) {
      return kind == null ? providers : providers.filter((entry) => entry.provider.kind === kind);
    },
    async activateProvider(providerId) {
      calls.push(["activate", providerId]);
      const entry = providers.find((candidate) => candidate.provider.id === providerId);
      if (!entry) throw new PluginRpcError(RPC_ERRORS.notFound, "missing provider");
      if (options.activateProvider) return options.activateProvider(entry);
      active.add(entry.pluginId);
      return {
        plugin: {
          id: entry.pluginId,
          activeVersion: entry.pluginVersion,
          manifest: {
            id: entry.pluginId,
            permissions: {
              required: ["provider.terminal", "terminal.complete", "terminal.output", "terminal.decorate"],
            },
          },
        },
        provider: entry.provider,
        identity: {
          pluginId: entry.pluginId,
          pluginVersion: entry.pluginVersion,
          runtimeId: `runtime:${entry.pluginId}`,
          runtimeKind: "browser",
          securityPrincipal: `principal:${entry.pluginId}`,
        },
      };
    },
    onDidChange(listener) {
      contributionListener = listener;
      return Object.freeze({ dispose() { contributionListener = null; } });
    },
  };
  const runtimeSupervisor = {
    async request(pluginId, method, params, requestOptions) {
      calls.push(["request", pluginId, method, params, requestOptions]);
      if (options.request) return options.request(pluginId, method, params, requestOptions);
      return {
        requestId: params.requestId,
        status: "ok",
        result: { items: [{ text: params.providerId, displayText: params.providerId, score: 1 }] },
      };
    },
    getRuntimeIdentity(pluginId) {
      if (options.getRuntimeIdentity) return options.getRuntimeIdentity(pluginId, active);
      return active.has(pluginId) ? {
        pluginId,
        pluginVersion: "1.0.0",
        runtimeId: `runtime:${pluginId}`,
        runtimeKind: "browser",
        securityPrincipal: `principal:${pluginId}`,
      } : null;
    },
    async notify(pluginId, method, params, notifyOptions) {
      notifications.push([pluginId, method, params, notifyOptions]);
    },
  };
  const permissionEngine = {
    async authorize(context, descriptor) {
      permissionCalls.push([context, descriptor]);
      if (options.authorize) return options.authorize(context, descriptor);
      return { scope: "existing" };
    },
  };
  return {
    calls,
    notifications,
    permissionCalls,
    emitContributionChange() { contributionListener?.(); },
    service: new PluginTerminalProviderService({ contributionService, permissionEngine, runtimeSupervisor }),
  };
}

const session = {
  sessionId: "session-1",
  hostId: "host-1",
  workspaceId: "workspace-1",
  protocol: "ssh",
  status: "connected",
  cwd: "/srv/app",
  title: "app",
  shellType: "posix",
  cols: 120,
  rows: 40,
  alternateScreen: false,
};

function completionPayload(input = "git") {
  return { input, cursor: input.length, hostOs: "linux", cwdSource: null, maximum: 100 };
}

test("terminal Provider registry ranks declared providers deterministically and excludes raw interceptors", () => {
  const { service } = setup();
  assert.deepEqual(
    service.listProviders({
      kind: "terminal.completion",
      preferredProviderIds: ["com.example.beta.completion"],
    }).map((entry) => entry.provider.id),
    ["com.example.beta.completion", "com.example.alpha.completion"],
  );
  assert.throws(
    () => service.listProviders({ kind: "terminal.interceptor.input" }),
    (error) => error?.code === RPC_ERRORS.unsupported,
  );
});

test("terminal Provider invocation lazily activates, forwards deadlines, and freezes bounded results", async () => {
  const { calls, notifications, permissionCalls, service } = setup();
  const result = await service.invokeProvider({
    providerId: "com.example.alpha.completion",
    kind: "terminal.completion",
    operation: "provideCompletions",
    requestId: "request-1",
    payload: { session, value: { input: "git st" } },
    deadlineMs: 250,
  });
  assert.deepEqual(result, {
    pluginId: "com.example.alpha",
    pluginVersion: "1.0.0",
    runtimeId: "runtime:com.example.alpha",
    providerId: "com.example.alpha.completion",
    kind: "terminal.completion",
    requestId: "request-1",
    status: "ok",
    result: {
      items: [{
        text: "com.example.alpha.completion",
        displayText: "com.example.alpha.completion",
        score: 1,
      }],
    },
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.result.items), true);
  assert.deepEqual(calls[0], ["activate", "com.example.alpha.completion"]);
  assert.equal(calls[1][1], "com.example.alpha");
  assert.equal(calls[1][2], "provider.invoke");
  assert.equal(calls[1][3].kind, "terminal.completion");
  assert.equal(calls[1][3].deadlineMs, 250);
  assert.equal(calls[1][4].timeoutMs, 250);
  assert.equal(calls[1][4].expectedIdentity.runtimeId, "runtime:com.example.alpha");
  assert.deepEqual(permissionCalls.map((call) => call[1].permission), [
    "provider.terminal",
    "terminal.complete",
  ]);
  assert.equal(permissionCalls[0][0].runtimeId, "runtime:com.example.alpha");
  assert.equal(permissionCalls[0][1].sessionId, session.sessionId);
  assert.deepEqual(notifications, [[
    "com.example.alpha",
    "plugin.terminal.event",
    { type: "snapshot", session },
    { expectedIdentity: {
      pluginId: "com.example.alpha",
      pluginVersion: "1.0.0",
      runtimeId: "runtime:com.example.alpha",
      runtimeKind: "browser",
      securityPrincipal: "principal:com.example.alpha",
    } },
  ]]);
});

test("terminal Provider cancellation releases a request while lazy activation is pending", async () => {
  let releaseActivation;
  let activationStarted;
  const started = new Promise((resolve) => { activationStarted = resolve; });
  const activationGate = new Promise((resolve) => { releaseActivation = resolve; });
  const fixture = setup({
    async activateProvider(entry) {
      activationStarted();
      await activationGate;
      return {
        plugin: {
          id: entry.pluginId,
          activeVersion: entry.pluginVersion,
          manifest: {
            id: entry.pluginId,
            permissions: { required: ["provider.terminal", "terminal.complete"] },
          },
        },
        provider: entry.provider,
        identity: {
          pluginId: entry.pluginId,
          pluginVersion: entry.pluginVersion,
          runtimeId: `runtime:${entry.pluginId}`,
          runtimeKind: "browser",
          securityPrincipal: `principal:${entry.pluginId}`,
        },
      };
    },
  });
  const controller = new AbortController();
  const pending = fixture.service.provide({
    kind: "terminal.completion",
    operation: "provideCompletions",
    session,
    payload: completionPayload(),
  }, { signal: controller.signal });
  await started;
  controller.abort();
  const result = await pending;
  assert.equal(result.length, 2);
  assert.equal(result.every((entry) => entry.status === "cancelled"), true);
  assert.equal(fixture.calls.some((call) => call[0] === "request"), false);
  releaseActivation();
});

test("terminal session snapshots preserve built-in and namespaced protocol identities", async () => {
  for (const protocol of ["mosh", "et", "com.example.transport"]) {
    const { service } = setup();
    const result = await service.provide({
      kind: "terminal.completion",
      operation: "provideCompletions",
      session: { ...session, protocol },
      payload: completionPayload(),
    });
    assert.equal(result[0].status, "ok");
  }
});

test("terminal session snapshots reject malformed protocol identities", async () => {
  const { service } = setup();
  await assert.rejects(
    service.provide({
      kind: "terminal.completion",
      operation: "provideCompletions",
      session: { ...session, protocol: "bad protocol" },
    }),
    /protocol is invalid/,
  );
});

test("terminal Provider invocation rejects kind drift and malformed or oversized results", async () => {
  const mismatch = setup();
  await assert.rejects(
    mismatch.service.invokeProvider({
      providerId: "com.example.alpha.completion",
      kind: "terminal.decoration",
      operation: "provide",
      requestId: "request-kind",
    }),
    (error) => error?.code === RPC_ERRORS.failedPrecondition,
  );

  const malformed = setup({
    request: async (_pluginId, _method, params) => ({
      requestId: `${params.requestId}-wrong`,
      status: "ok",
      result: null,
    }),
  });
  await assert.rejects(
    malformed.service.invokeProvider({
      providerId: "com.example.alpha.completion",
      kind: "terminal.completion",
      operation: "provide",
      requestId: "request-mismatch",
    }),
    (error) => error?.code === RPC_ERRORS.dataLoss,
  );

  const oversized = setup({
    request: async (_pluginId, _method, params) => ({
      requestId: params.requestId,
      status: "ok",
      result: "x".repeat(128 * 1024),
    }),
  });
  await assert.rejects(
    oversized.service.invokeProvider({
      providerId: "com.example.alpha.completion",
      kind: "terminal.completion",
      operation: "provide",
      requestId: "request-oversized",
    }),
    (error) => error?.code === RPC_ERRORS.dataLoss,
  );
});

test("terminal completion and decoration results use main-process operation validation", async () => {
  for (const [kind, operation, payload, result] of [
    ["terminal.completion", "provideCompletions", completionPayload(), {
      items: [{ text: "git status", displayText: "git status", description: "Status", score: 10 }],
    }],
    ["terminal.decoration", "provideDecorations", { reason: "session-state" }, {
      rules: [{ id: "error", label: "Error", patterns: ["\\berror\\b"], color: "#ff0000" }],
    }],
  ]) {
    const fixture = setup({
      request: async (_pluginId, _method, params) => ({
        requestId: params.requestId,
        status: "ok",
        result,
      }),
      providers: [provider("com.example.alpha", `com.example.alpha.${kind}`, kind)],
    });
    const response = await fixture.service.provide({ kind, operation, session, payload });
    assert.equal(response[0].status, "ok", kind);
  }

  for (const [kind, payload, result] of [
    ["terminal.completion", completionPayload(), { items: [{ label: "hidden command" }] }],
    ["terminal.completion", completionPayload(), {
      items: [{ text: "rm -rf -- /", displayText: "Refresh index" }],
    }],
    ["terminal.decoration", { reason: "session-state" }, {
      rules: [{ id: "invalid", label: "Invalid", patterns: [], color: "red" }],
    }],
  ]) {
    const fixture = setup({
      request: async (_pluginId, _method, params) => ({
        requestId: params.requestId,
        status: "ok",
        result,
      }),
      providers: [provider("com.example.alpha", `com.example.alpha.${kind}`, kind)],
    });
    const response = await fixture.service.provide({
      kind,
      operation: kind === "terminal.completion" ? "provideCompletions" : "provideDecorations",
      session,
      payload,
    });
    assert.equal(response[0].status, "failed", kind);
    assert.equal(response[0].error.code, RPC_ERRORS.dataLoss, kind);
  }

  await assert.rejects(
    setup().service.provide({
      kind: "terminal.completion",
      operation: "provideLinks",
      session,
      payload: completionPayload(),
    }),
    (error) => error?.code === RPC_ERRORS.invalidArgument,
  );
});

test("terminal link and hover results are validated against the host line", async () => {
  for (const [kind, result] of [
    ["terminal.link", { links: [{ start: 0, length: 4, uri: "https://example.com" }] }],
    ["terminal.hover", { hovers: [{ start: 0, length: 4, contents: "Details" }] }],
  ]) {
    const fixture = setup({
      request: async (_pluginId, _method, params) => ({
        requestId: params.requestId,
        status: "ok",
        result,
      }),
      providers: [provider("com.example.alpha", `com.example.alpha.${kind}`, kind)],
    });
    const response = await fixture.service.provide({
      kind,
      operation: kind === "terminal.link" ? "provideLinks" : "provideHovers",
      session,
      payload: { line: "test", bufferLineNumber: 1 },
    });
    assert.equal(response[0].status, "ok");
  }

  const invalid = setup({
    request: async (_pluginId, _method, params) => ({
      requestId: params.requestId,
      status: "ok",
      result: { links: [{ start: 0, length: 99, uri: "javascript:alert(1)" }] },
    }),
    providers: [provider("com.example.alpha", "com.example.alpha.links", "terminal.link")],
  });
  const response = await invalid.service.provide({
    kind: "terminal.link",
    operation: "provideLinks",
    session,
    payload: { line: "test", bufferLineNumber: 1 },
  });
  assert.equal(response[0].status, "failed");
  assert.equal(response[0].error.code, RPC_ERRORS.dataLoss);
});

test("terminal matcher, semantic, prompt, background, and theme results use operation-specific validation", async () => {
  const cases = [
    ["terminal.matcher", "provideMatches", { lines: [{ lineId: "line-1", line: "failed", bufferLineNumber: 1 }] }, {
      matches: [{ lineId: "line-1", start: 0, length: 6, label: "Failure", severity: "error", color: "#ff0000" }],
    }],
    ["terminal.semantic", "provideSemantics", { command: "deploy" }, {
      classification: "deployment",
      destructive: true,
      annotations: [{ text: "production", color: "#ff0000" }],
    }],
    ["terminal.prompt", "provideAnnotations", { reason: "commandCompleted" }, {
      annotations: [{ text: "venv", color: "#00ff00" }],
    }],
    ["terminal.background", "provideBackgrounds", { reason: "runtime-created" }, {
      layers: [{ id: "tint", color: "#102030", opacity: 0.25 }],
      refreshAfterMs: 250,
    }],
    ["terminal.theme", "provideTheme", { reason: "theme-changed", currentTheme: {
      type: "dark",
      colors: Object.fromEntries([
        "background", "foreground", "cursor", "selection",
        "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
        "brightBlack", "brightRed", "brightGreen", "brightYellow",
        "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
      ].map((key) => [key, "#000000"])),
    } }, {
      colors: { background: "#102030", foreground: "#f0f0f0", cursor: "#abcdef" },
    }],
  ];
  for (const [kind, operation, payload, result] of cases) {
    const fixture = setup({
      request: async (_pluginId, _method, params) => ({
        requestId: params.requestId,
        status: "ok",
        result,
      }),
      providers: [provider("com.example.alpha", `com.example.alpha.${kind}`, kind)],
    });
    const response = await fixture.service.provide({
      kind,
      operation,
      session,
      payload,
    });
    assert.equal(response[0].status, "ok", kind);
  }

  const invalid = setup({
    request: async (_pluginId, _method, params) => ({
      requestId: params.requestId,
      status: "ok",
      result: { layers: [{ id: "cover", color: "#000000", opacity: 1 }] },
    }),
    providers: [provider("com.example.alpha", "com.example.alpha.background", "terminal.background")],
  });
  const response = await invalid.service.provide({
    kind: "terminal.background",
    operation: "provideBackgrounds",
    session,
    payload: { reason: "runtime-created" },
  });
  assert.equal(response[0].status, "failed");
  assert.equal(response[0].error.code, RPC_ERRORS.dataLoss);

  const invalidMatcher = setup({
    request: async (_pluginId, _method, params) => ({
      requestId: params.requestId,
      status: "ok",
      result: { matches: [{ lineId: "other", start: 0, length: 1, label: "Hidden" }] },
    }),
    providers: [provider("com.example.alpha", "com.example.alpha.matcher", "terminal.matcher")],
  });
  const matcherResponse = await invalidMatcher.service.provide({
    kind: "terminal.matcher",
    operation: "provideMatches",
    session,
    payload: { lines: [{ lineId: "line-1", line: "failed", bufferLineNumber: 1 }] },
  });
  assert.equal(matcherResponse[0].status, "failed");
  assert.equal(matcherResponse[0].error.code, RPC_ERRORS.dataLoss);

  const invalidRefresh = setup({
    request: async (_pluginId, _method, params) => ({
      requestId: params.requestId,
      status: "ok",
      result: { layers: [], refreshAfterMs: 10 },
    }),
    providers: [provider("com.example.alpha", "com.example.alpha.background", "terminal.background")],
  });
  const refreshResponse = await invalidRefresh.service.provide({
    kind: "terminal.background",
    operation: "provideBackgrounds",
    session,
    payload: { reason: "runtime-created" },
  });
  assert.equal(refreshResponse[0].status, "failed");
  assert.equal(refreshResponse[0].error.code, RPC_ERRORS.dataLoss);

  const oversizedMatcherBatch = setup({
    request: async (_pluginId, _method, params) => ({
      requestId: params.requestId,
      status: "ok",
      result: { matches: [] },
    }),
    providers: [provider("com.example.alpha", "com.example.alpha.matcher", "terminal.matcher")],
  });
  await assert.rejects(
    oversizedMatcherBatch.service.provide({
      kind: "terminal.matcher",
      operation: "provideMatches",
      session,
      payload: {
        lines: Array.from({ length: 13 }, (_, index) => ({
          lineId: `line-${index}`,
          line: "x".repeat(8_192),
          bufferLineNumber: index + 1,
        })),
      },
    }),
    (error) => error?.code === RPC_ERRORS.invalidArgument,
  );

  const missingBackgroundColor = setup({
    request: async (_pluginId, _method, params) => ({
      requestId: params.requestId,
      status: "ok",
      result: { layers: [{ id: "missing-color", opacity: 0.1 }] },
    }),
    providers: [provider("com.example.alpha", "com.example.alpha.background", "terminal.background")],
  });
  const missingColorResponse = await missingBackgroundColor.service.provide({
    kind: "terminal.background",
    operation: "provideBackgrounds",
    session,
    payload: { reason: "runtime-created" },
  });
  assert.equal(missingColorResponse[0].status, "failed");
  assert.equal(missingColorResponse[0].error.code, RPC_ERRORS.dataLoss);
});

test("terminal Provider invocation authorizes optional permissions before sending session data", async () => {
  const fixture = setup({
    authorize: async (_context, descriptor) => {
      if (descriptor.permission === "terminal.complete") {
        throw new PluginRpcError(RPC_ERRORS.permissionDenied, "permission denied");
      }
      return { scope: "existing" };
    },
  });
  await assert.rejects(
    fixture.service.invokeProvider({
      providerId: "com.example.alpha.completion",
      kind: "terminal.completion",
      operation: "provide",
      requestId: "request-denied",
      payload: { session },
    }),
    (error) => error?.code === RPC_ERRORS.permissionDenied,
  );
  assert.deepEqual(fixture.permissionCalls.map((call) => call[1].permission), [
    "provider.terminal",
    "terminal.complete",
  ]);
  assert.deepEqual(fixture.notifications, []);
  assert.equal(fixture.calls.some((call) => call[0] === "request"), false);
});

test("terminal Provider fan-out contains failures and preserves deterministic registry order", async () => {
  const { calls, service } = setup({
    request: async (pluginId, _method, params) => {
      if (pluginId === "com.example.alpha") {
        throw new PluginRpcError(RPC_ERRORS.unavailable, "alpha unavailable");
      }
      return { requestId: params.requestId, status: "ok", result: { items: [{ text: "beta", score: 1 }] } };
    },
  });
  const results = await service.provide({
    kind: "terminal.completion",
    operation: "provideCompletions",
    session,
    payload: { ...completionPayload("be"), session: { sessionId: "spoofed" } },
    preferredProviderIds: ["com.example.beta.completion"],
    deadlineMs: 300,
  });
  assert.equal(results.length, 2);
  assert.equal(results[0].providerId, "com.example.beta.completion");
  assert.equal(results[0].status, "ok");
  assert.equal(results[1].providerId, "com.example.alpha.completion");
  assert.equal(results[1].status, "failed");
  assert.equal(results[1].error.code, RPC_ERRORS.unavailable);
  const forwarded = calls.find((call) => call[0] === "request");
  assert.equal(forwarded[3].payload.input, "be");
  assert.equal(forwarded[3].payload.session.sessionId, session.sessionId);
});

test("terminal lifecycle delivery targets only active Provider runtimes and strips sensitive command text", async () => {
  const { notifications, service } = setup({ activePluginIds: ["com.example.alpha"] });
  const beforeAuthorization = await service.publishSessionEvent({
    type: "connected",
    session,
  });
  assert.deepEqual(beforeAuthorization, [
    { pluginId: "com.example.alpha", delivered: false },
    { pluginId: "com.example.beta", delivered: false },
  ]);
  assert.deepEqual(notifications, []);
  await service.invokeProvider({
    providerId: "com.example.alpha.completion",
    kind: "terminal.completion",
    operation: "provide",
    requestId: "authorize-lifecycle",
    payload: { session },
  });
  notifications.length = 0;
  const deliveries = await service.publishSessionEvent({
    type: "commandSubmitted",
    session,
    command: "export TOKEN=secret",
  });
  assert.deepEqual(deliveries, [
    { pluginId: "com.example.alpha", delivered: true },
    { pluginId: "com.example.beta", delivered: false },
  ]);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0][0], "com.example.alpha");
  assert.equal(notifications[0][1], "plugin.terminal.event");
  assert.equal(Object.hasOwn(notifications[0][2], "command"), false);
  assert.equal(Object.isFrozen(notifications[0][2].session), true);
  await service.publishSessionEvent({
    type: "commandCompleted",
    session,
    command: "export TOKEN=secret",
    output: "secret",
  });
  assert.equal(Object.hasOwn(notifications.at(-1)[2], "command"), false);
  assert.equal(Object.hasOwn(notifications.at(-1)[2], "output"), false);
  await service.publishSessionEvent({
    type: "disconnected",
    session: { ...session, status: "disconnected" },
    exitCode: 0xC0000005,
  });
  assert.equal(notifications.at(-1)[2].exitCode, 0xC0000005);
  assert.deepEqual(normalizeTerminalSessionEvent({ type: "disposed", session }), {
    type: "disposed",
    session,
  });
});

test("terminal lifecycle preserves signed and unsigned wide platform exit statuses", () => {
  assert.deepEqual(normalizeTerminalSessionEvent({
    type: "disconnected",
    session: { ...session, status: "disconnected" },
    exitCode: 0xC0000005,
  }).exitCode, 0xC0000005);
  assert.deepEqual(normalizeTerminalSessionEvent({
    type: "disconnected",
    session: { ...session, status: "disconnected" },
    exitCode: -1073741819,
  }).exitCode, -1073741819);
  for (const exitCode of [1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => normalizeTerminalSessionEvent({
      type: "disconnected",
      session: { ...session, status: "disconnected" },
      exitCode,
    }), /exit code is invalid/);
  }
});

test("one-use Provider grants never authorize later lifecycle delivery", async () => {
  const { notifications, service } = setup({
    authorize: async () => ({ scope: "once" }),
  });
  await service.invokeProvider({
    providerId: "com.example.alpha.completion",
    kind: "terminal.completion",
    operation: "provide",
    requestId: "one-use-lifecycle",
    payload: { session },
  });
  notifications.length = 0;
  const deliveries = await service.publishSessionEvent({ type: "cwdChanged", session });
  assert.deepEqual(deliveries, [
    { pluginId: "com.example.alpha", delivered: false },
    { pluginId: "com.example.beta", delivered: false },
  ]);
  assert.deepEqual(notifications, []);
});

test("failed and cancelled Provider results never authorize later lifecycle delivery", async () => {
  for (const status of ["failed", "cancelled"]) {
    const { notifications, service } = setup({
      request: async (_pluginId, _method, params) => status === "failed"
        ? {
            requestId: params.requestId,
            status,
            error: { code: RPC_ERRORS.internal, message: "provider failed" },
          }
        : { requestId: params.requestId, status },
    });
    const result = await service.invokeProvider({
      providerId: "com.example.alpha.completion",
      kind: "terminal.completion",
      operation: "provide",
      requestId: `unsuccessful-${status}`,
      payload: { session },
    });
    assert.equal(result.status, status);
    notifications.length = 0;
    const deliveries = await service.publishSessionEvent({ type: "resized", session });
    assert.deepEqual(deliveries, [
      { pluginId: "com.example.alpha", delivered: false },
      { pluginId: "com.example.beta", delivered: false },
    ]);
    assert.deepEqual(notifications, []);
  }
});

test("terminal lifecycle cleanup removes authorizations for unavailable providers and disposed sessions", async () => {
  const providers = [provider("com.example.alpha", "com.example.alpha.completion", "terminal.completion")];
  const { emitContributionChange, service } = setup({ providers });
  await service.invokeProvider({
    providerId: "com.example.alpha.completion",
    kind: "terminal.completion",
    operation: "provide",
    requestId: "authorize-cleanup",
    payload: { session },
  });
  assert.equal(service.lifecycleAuthorizations.size, 1);

  providers.length = 0;
  emitContributionChange();
  assert.equal(service.lifecycleAuthorizations.size, 0);

  providers.push(provider("com.example.alpha", "com.example.alpha.completion", "terminal.completion"));
  await service.invokeProvider({
    providerId: "com.example.alpha.completion",
    kind: "terminal.completion",
    operation: "provide",
    requestId: "authorize-dispose",
    payload: { session },
  });
  assert.equal(service.lifecycleAuthorizations.size, 1);
  await service.publishSessionEvent({ type: "disposed", session });
  assert.equal(service.lifecycleAuthorizations.size, 0);
});

test("terminal Provider fan-out enforces the per-request Provider quota", async () => {
  const providers = Array.from({ length: MAX_TERMINAL_PROVIDERS_PER_REQUEST + 5 }, (_, index) => provider(
    `com.example.provider${String(index).padStart(2, "0")}`,
    `com.example.provider${String(index).padStart(2, "0")}.completion`,
    "terminal.completion",
  ));
  const { calls, service } = setup({ providers });
  const results = await service.provide({
    kind: "terminal.completion",
    operation: "provideCompletions",
    session,
    payload: completionPayload(),
  });
  assert.equal(results.length, MAX_TERMINAL_PROVIDERS_PER_REQUEST);
  assert.equal(calls.filter((call) => call[0] === "request").length, MAX_TERMINAL_PROVIDERS_PER_REQUEST);
});
