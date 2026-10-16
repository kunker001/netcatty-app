"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createTerminalInterceptorEnvelope,
} = require("../terminalInterceptorTransport.cjs");

class FakePort {
  constructor() {
    this.listeners = new Set();
    this.messages = [];
    this.closed = false;
  }

  addEventListener(type, listener) {
    if (type === "message") this.listeners.add(listener);
  }

  removeEventListener(type, listener) {
    if (type === "message") this.listeners.delete(listener);
  }

  postMessage(message, transfer = []) {
    this.messages.push({ message, transfer });
  }

  start() {}

  close() { this.closed = true; }

  emit(data, ports = []) {
    for (const listener of this.listeners) listener({ data, ports });
  }
}

async function tick() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("utility runtime dispatches dedicated terminal ports to the exact registered interceptor", async () => {
  const { startPluginRuntime } = await import("./runtimePeer.mjs");
  const control = new FakePort();
  const runtime = await startPluginRuntime({
    port: control,
    config: {
      pluginId: "com.example",
      pluginVersion: "1.0.0",
      netcattyVersion: "1.0.0",
      apiVersion: "1.0.0",
      enabledFeatures: [],
      environment: {},
      entryUrl: "file:///plugin.js",
    },
    loadPlugin: async () => ({
      default: {
        activate(context) {
          context.providers.register(
            "com.example.input",
            "terminal.interceptor.input",
            ({ data }) => Uint8Array.from([...data].map((byte) => byte >= 97 && byte <= 122 ? byte - 32 : byte)),
          );
        },
      },
    }),
  });
  control.emit({ jsonrpc: "2.0", id: 1, method: "plugin.initialize", params: {} });
  await tick();
  control.emit({ jsonrpc: "2.0", id: 2, method: "plugin.activate", params: {} });
  await tick();

  const dataPort = new FakePort();
  control.emit({
    jsonrpc: "2.0",
    id: 3,
    method: "plugin.terminal.interceptor.attach",
    params: {
      descriptor: {
        providerId: "com.example.input",
        direction: "input",
        session: { sessionId: "session-1", protocol: "ssh", status: "connected" },
      },
    },
  }, [dataPort]);
  await tick();
  assert.equal(
    control.messages.some(({ message }) => (
      message.jsonrpc === "2.0"
      && message.id === 3
      && message.result?.accepted === true
    )),
    true,
  );
  dataPort.emit(createTerminalInterceptorEnvelope({
    type: "netcatty:terminal-interceptor:ready",
    sessionId: "session-1",
    direction: "input",
    windowBytes: 64 * 1024,
  }));
  assert.equal(dataPort.closed, false);
  const data = Uint8Array.from(Buffer.from("hello")).buffer;
  dataPort.emit(createTerminalInterceptorEnvelope({
    type: "netcatty:terminal-interceptor:chunk",
    sequence: 1,
    direction: "input",
    creditBytes: 64 * 1024,
    byteLength: data.byteLength,
  }, data));
  await tick();
  assert.equal(dataPort.messages.length, 1);
  const result = createTerminalInterceptorEnvelope(
    dataPort.messages[0].message.frame,
    dataPort.messages[0].message.transfer,
  );
  assert.equal(result.frame.status, "ok");
  assert.equal(result.frame.creditBytes, 5);
  assert.equal(Buffer.from(result.transfer).toString("utf8"), "HELLO");
  assert.deepEqual(dataPort.messages[0].transfer, [result.transfer]);
  await runtime.dispose();
});

test("utility runtime closes a terminal port when provider ownership or kind is invalid", async () => {
  const { startPluginRuntime } = await import("./runtimePeer.mjs");
  const control = new FakePort();
  const runtime = await startPluginRuntime({
    port: control,
    config: {
      pluginId: "com.example",
      pluginVersion: "1.0.0",
      netcattyVersion: "1.0.0",
      apiVersion: "1.0.0",
      enabledFeatures: [],
      environment: {},
      entryUrl: "file:///plugin.js",
    },
    loadPlugin: async () => ({ default: { activate() {} } }),
  });
  control.emit({ jsonrpc: "2.0", id: 1, method: "plugin.initialize", params: {} });
  await tick();
  control.emit({ jsonrpc: "2.0", id: 2, method: "plugin.activate", params: {} });
  await tick();
  const dataPort = new FakePort();
  control.emit({
    jsonrpc: "2.0",
    id: 3,
    method: "plugin.terminal.interceptor.attach",
    params: {
      descriptor: {
        providerId: "com.example.missing",
        direction: "input",
        session: { sessionId: "session-1" },
      },
    },
  }, [dataPort]);
  await tick();
  assert.equal(dataPort.closed, true);
  assert.equal(
    control.messages.some(({ message }) => (
      message.jsonrpc === "2.0"
      && message.id === 3
      && message.error?.code === -32009
    )),
    true,
  );
  await runtime.dispose();
});

test("utility runtime closes the transferred terminal port when the provider belongs to another plugin", async () => {
  const { startPluginRuntime } = await import("./runtimePeer.mjs");
  const control = new FakePort();
  const runtime = await startPluginRuntime({
    port: control,
    config: {
      pluginId: "com.example",
      pluginVersion: "1.0.0",
      netcattyVersion: "1.0.0",
      apiVersion: "1.0.0",
      enabledFeatures: [],
      environment: {},
      entryUrl: "file:///plugin.js",
    },
    loadPlugin: async () => ({ default: { activate() {} } }),
  });
  control.emit({ jsonrpc: "2.0", id: 1, method: "plugin.initialize", params: {} });
  await tick();
  control.emit({ jsonrpc: "2.0", id: 2, method: "plugin.activate", params: {} });
  await tick();
  const dataPort = new FakePort();
  control.emit({
    jsonrpc: "2.0",
    id: 3,
    method: "plugin.terminal.interceptor.attach",
    params: {
      descriptor: {
        providerId: "other.plugin.input",
        direction: "input",
        session: { sessionId: "session-1", protocol: "ssh", status: "connected" },
      },
    },
  }, [dataPort]);
  await tick();
  assert.equal(dataPort.closed, true);
  assert.equal(
    control.messages.some(({ message }) => (
      message.jsonrpc === "2.0"
      && message.id === 3
      && message.error?.code === -32003
    )),
    true,
  );
  await runtime.dispose();
});

test("utility runtime closes unexpected transferred ports on every lifecycle request", async () => {
  const { startPluginRuntime } = await import("./runtimePeer.mjs");
  const control = new FakePort();
  const runtime = await startPluginRuntime({
    port: control,
    config: {
      pluginId: "com.example",
      pluginVersion: "1.0.0",
      netcattyVersion: "1.0.0",
      apiVersion: "1.0.0",
      enabledFeatures: [],
      environment: {},
      entryUrl: "file:///plugin.js",
    },
    loadPlugin: async () => ({ default: { activate() {} } }),
  });
  const lifecycleRequests = [
    { id: 1, method: "plugin.initialize", params: {} },
    { id: 2, method: "plugin.activate", params: {} },
    { id: 3, method: "plugin.deactivate", params: {} },
  ];
  for (const request of lifecycleRequests) {
    const unexpectedPort = new FakePort();
    control.emit({ jsonrpc: "2.0", ...request }, [unexpectedPort]);
    await tick();
    assert.equal(unexpectedPort.closed, true, `${request.method} retained an unexpected port`);
    assert.equal(
      control.messages.some(({ message }) => (
        message.jsonrpc === "2.0"
        && message.id === request.id
        && Object.hasOwn(message, "result")
      )),
      true,
      `${request.method} did not complete after closing its unexpected port`,
    );
  }
  await runtime.dispose();
});

test("utility runtime rejects the retired private terminal attachment protocol", async () => {
  const { startPluginRuntime } = await import("./runtimePeer.mjs");
  const control = new FakePort();
  const runtime = await startPluginRuntime({
    port: control,
    config: {
      pluginId: "com.example",
      pluginVersion: "1.0.0",
      netcattyVersion: "1.0.0",
      apiVersion: "1.0.0",
      enabledFeatures: [],
      environment: {},
      entryUrl: "file:///plugin.js",
    },
    loadPlugin: async () => ({ default: { activate() {} } }),
  });
  const dataPort = new FakePort();
  control.emit({
    type: "netcatty-plugin:terminal-interceptor:attach",
    attachmentId: 1,
    descriptor: { providerId: "com.example.input", direction: "input" },
  }, [dataPort]);
  assert.equal(dataPort.closed, true);
  assert.equal(control.messages.length, 0);
  await runtime.dispose();
});

test("terminal ports convert synchronous throws to failures and stop using disposed handlers", async () => {
  const { startPluginRuntime } = await import("./runtimePeer.mjs");
  const control = new FakePort();
  let registration;
  let calls = 0;
  const runtime = await startPluginRuntime({
    port: control,
    config: {
      pluginId: "com.example",
      pluginVersion: "1.0.0",
      netcattyVersion: "1.0.0",
      apiVersion: "1.0.0",
      enabledFeatures: [],
      environment: {},
      entryUrl: "file:///plugin.js",
    },
    loadPlugin: async () => ({
      default: {
        activate(context) {
          registration = context.providers.register(
            "com.example.input",
            "terminal.interceptor.input",
            () => {
              calls += 1;
              throw new Error("synchronous failure");
            },
          );
        },
      },
    }),
  });
  control.emit({ jsonrpc: "2.0", id: 1, method: "plugin.initialize", params: {} });
  await tick();
  control.emit({ jsonrpc: "2.0", id: 2, method: "plugin.activate", params: {} });
  await tick();

  const dataPort = new FakePort();
  control.emit({
    jsonrpc: "2.0",
    id: 3,
    method: "plugin.terminal.interceptor.attach",
    params: {
      descriptor: {
        providerId: "com.example.input",
        direction: "input",
        session: { sessionId: "session-1", protocol: "ssh", status: "connected" },
      },
    },
  }, [dataPort]);
  await tick();
  const send = (sequence) => {
    const data = Uint8Array.from([sequence]).buffer;
    dataPort.emit(createTerminalInterceptorEnvelope({
      type: "netcatty:terminal-interceptor:chunk",
      sequence,
      direction: "input",
      creditBytes: 64 * 1024,
      byteLength: data.byteLength,
    }, data));
  };
  send(1);
  await tick();
  assert.equal(dataPort.messages[0].message.frame.status, "failed");
  assert.equal(calls, 1);

  registration.dispose();
  send(2);
  await tick();
  assert.equal(dataPort.messages[1].message.frame.status, "failed");
  assert.equal(calls, 1);
  await runtime.dispose();
});

test("the utility peer closes a port whose chunk bypasses the canonical terminal frame schema", async () => {
  const { startPluginRuntime } = await import("./runtimePeer.mjs");
  const control = new FakePort();
  const runtime = await startPluginRuntime({
    port: control,
    config: {
      pluginId: "com.example",
      pluginVersion: "1.0.0",
      netcattyVersion: "1.0.0",
      apiVersion: "1.0.0",
      enabledFeatures: [],
      environment: {},
      entryUrl: "file:///plugin.js",
    },
    loadPlugin: async () => ({
      default: {
        activate(context) {
          context.providers.register(
            "com.example.input",
            "terminal.interceptor.input",
            ({ data }) => data,
          );
        },
      },
    }),
  });
  control.emit({ jsonrpc: "2.0", id: 1, method: "plugin.initialize", params: {} });
  await tick();
  control.emit({ jsonrpc: "2.0", id: 2, method: "plugin.activate", params: {} });
  await tick();
  const dataPort = new FakePort();
  control.emit({
    jsonrpc: "2.0",
    id: 3,
    method: "plugin.terminal.interceptor.attach",
    params: {
      descriptor: {
        providerId: "com.example.input",
        direction: "input",
        session: { sessionId: "session-1", protocol: "ssh", status: "connected" },
      },
    },
  }, [dataPort]);
  await tick();
  const data = Uint8Array.from(Buffer.from("unsafe")).buffer;
  dataPort.emit({
    frame: {
      type: "netcatty:terminal-interceptor:chunk",
      sequence: 1,
      direction: "input",
      creditBytes: 64 * 1024,
      byteLength: data.byteLength,
      extra: true,
    },
    transfer: data,
  });
  assert.equal(dataPort.closed, true);
  assert.equal(dataPort.messages.length, 0);
  await runtime.dispose();
});

test("utility runtime disposal closes a terminal port while its transport helper is loading", async () => {
  const { startPluginRuntime } = await import("./runtimePeer.mjs");
  const control = new FakePort();
  let resolveTransport;
  const transportLoading = new Promise((resolve) => { resolveTransport = resolve; });
  const runtime = await startPluginRuntime({
    port: control,
    config: {
      pluginId: "com.example",
      pluginVersion: "1.0.0",
      netcattyVersion: "1.0.0",
      apiVersion: "1.0.0",
      enabledFeatures: [],
      environment: {},
      entryUrl: "file:///plugin.js",
    },
    loadPlugin: async () => ({
      default: {
        activate(context) {
          context.providers.register(
            "com.example.input",
            "terminal.interceptor.input",
            ({ data }) => data,
          );
        },
      },
    }),
    loadTerminalInterceptorTransport: () => transportLoading,
  });
  control.emit({ jsonrpc: "2.0", id: 1, method: "plugin.initialize", params: {} });
  await tick();
  control.emit({ jsonrpc: "2.0", id: 2, method: "plugin.activate", params: {} });
  await tick();

  const dataPort = new FakePort();
  control.emit({
    jsonrpc: "2.0",
    id: 3,
    method: "plugin.terminal.interceptor.attach",
    params: {
      descriptor: {
        providerId: "com.example.input",
        direction: "input",
        session: { sessionId: "session-1", protocol: "ssh", status: "connected" },
      },
    },
  }, [dataPort]);
  await tick();
  assert.equal(dataPort.closed, false);

  await runtime.dispose();
  assert.equal(dataPort.closed, true);
  resolveTransport({
    TERMINAL_INTERCEPTOR_MAX_CHUNK_BYTES: 64 * 1024,
    createTerminalInterceptorEnvelope,
  });
  await tick();
  assert.equal(
    control.messages.some(({ message }) => message.id === 3 && message.result?.accepted === true),
    false,
  );
  assert.equal(dataPort.closed, true);
});
