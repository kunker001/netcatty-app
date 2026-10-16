import test from "node:test";
import assert from "node:assert/strict";

import {
  signalPluginConnectionWithBridge,
  startPluginConnectionWithBridge,
} from "./useTerminalBackend";

const startOptions = {
  requestId: "plugin-connection-test-request",
  sessionId: "session-plugin",
  providerId: "com.example.connection",
  configuration: { endpoint: "example.test" },
  columns: 120,
  rows: 32,
} satisfies NetcattyPluginConnectionStartRequest;

test("startPluginConnectionWithBridge uses the caller request ID and strips the renderer-only signal", async () => {
  const controller = new AbortController();
  const providerRequests: NetcattyExtensionProviderRequest[] = [];
  let startRequest: NetcattyPluginConnectionStartRequest | null = null;
  const bridge = {
    async invokePluginExtensionProvider(request: NetcattyExtensionProviderRequest) {
      providerRequests.push(request);
      return request.operation === "validateConfiguration"
        ? { valid: true, issues: [] }
        : { available: true };
    },
    async startPluginConnection(request: NetcattyPluginConnectionStartRequest) {
      startRequest = request;
      return {
        sessionId: request.sessionId,
        providerId: request.providerId,
        status: "connected" as const,
        diagnostics: [],
      };
    },
  };

  const opened = await startPluginConnectionWithBridge(bridge, {
    ...startOptions,
    signal: controller.signal,
  });

  assert.equal(providerRequests[0]?.requestId, startOptions.requestId);
  assert.equal(providerRequests[0]?.operation, "validateConfiguration");
  assert.equal(providerRequests[1]?.requestId, startOptions.requestId);
  assert.equal(providerRequests[1]?.operation, "probe");
  assert.equal(startRequest?.requestId, startOptions.requestId);
  assert.equal("signal" in (startRequest as Record<string, unknown>), false);
  assert.equal(opened.sessionId, startOptions.sessionId);
});

test("startPluginConnectionWithBridge stops before connection start when cancelled after validation", async () => {
  const controller = new AbortController();
  let startCalled = false;
  const bridge = {
    async invokePluginExtensionProvider(request: NetcattyExtensionProviderRequest) {
      assert.equal(request.requestId, startOptions.requestId);
      assert.equal(request.operation, "validateConfiguration");
      controller.abort(new DOMException("Terminal closed", "AbortError"));
      return { valid: true };
    },
    async startPluginConnection(_request: NetcattyPluginConnectionStartRequest) {
      startCalled = true;
      throw new Error("connection start should not run after cancellation");
    },
  };

  await assert.rejects(
    startPluginConnectionWithBridge(bridge, {
      ...startOptions,
      signal: controller.signal,
    }),
    /Terminal closed/,
  );
  assert.equal(startCalled, false);
});

test("startPluginConnectionWithBridge stops before connection start when the Provider probe is unavailable", async () => {
  let startCalled = false;
  const bridge = {
    async invokePluginExtensionProvider(request: NetcattyExtensionProviderRequest) {
      return request.operation === "validateConfiguration"
        ? { valid: true, issues: [] }
        : { available: false, message: "Required helper is missing" };
    },
    async startPluginConnection(_request: NetcattyPluginConnectionStartRequest) {
      startCalled = true;
      throw new Error("connection start should not run after an unavailable probe");
    },
  };

  await assert.rejects(startPluginConnectionWithBridge(bridge, startOptions), /Required helper is missing/);
  assert.equal(startCalled, false);
});

test("startPluginConnectionWithBridge keeps the caller request ID while a Provider probe is cancelled", async () => {
  const controller = new AbortController();
  let probeRequest: NetcattyExtensionProviderRequest | null = null;
  let probeEnteredResolve: (() => void) | null = null;
  const probeEntered = new Promise<void>((resolve) => { probeEnteredResolve = resolve; });
  let startCalled = false;
  const bridge = {
    async invokePluginExtensionProvider(request: NetcattyExtensionProviderRequest) {
      if (request.operation === "validateConfiguration") return { valid: true, issues: [] };
      probeRequest = request;
      probeEnteredResolve?.();
      return new Promise<never>(() => {});
    },
    async startPluginConnection(_request: NetcattyPluginConnectionStartRequest) {
      startCalled = true;
      throw new Error("connection start should not run after cancellation");
    },
  };

  const opening = startPluginConnectionWithBridge(bridge, {
    ...startOptions,
    signal: controller.signal,
  });
  await probeEntered;
  controller.abort(new DOMException("Terminal closed during probe", "AbortError"));

  await assert.rejects(opening, /Terminal closed during probe/);
  assert.equal(probeRequest?.requestId, startOptions.requestId);
  assert.equal(startCalled, false);
});

test("signalPluginConnectionWithBridge routes host interrupts to the Provider signal operation", async () => {
  const calls: unknown[] = [];
  const bridge = {
    async controlPluginConnection(sessionId: string, operation: "signal", payload: Record<string, unknown>) {
      calls.push([sessionId, operation, payload]);
      return null;
    },
  };
  await signalPluginConnectionWithBridge(bridge, "plugin-session", "interrupt");
  assert.deepEqual(calls, [["plugin-session", "signal", { signal: "interrupt" }]]);
});

test("startPluginConnectionWithBridge rejects promptly when cancelled during validation", async () => {
  const controller = new AbortController();
  let resolveValidationStarted: (() => void) | null = null;
  const validationStarted = new Promise<void>((resolve) => { resolveValidationStarted = resolve; });
  let startCalled = false;
  const bridge = {
    async invokePluginExtensionProvider(request: NetcattyExtensionProviderRequest) {
      assert.equal(request.requestId, startOptions.requestId);
      resolveValidationStarted?.();
      await new Promise(() => {});
      return { valid: true };
    },
    async startPluginConnection(_request: NetcattyPluginConnectionStartRequest) {
      startCalled = true;
      throw new Error("connection start should not run after cancellation");
    },
  };

  const start = startPluginConnectionWithBridge(bridge, {
    ...startOptions,
    signal: controller.signal,
  });
  await validationStarted;
  controller.abort(new DOMException("Terminal closed", "AbortError"));

  await assert.rejects(start, /Terminal closed/);
  assert.equal(startCalled, false);
});
