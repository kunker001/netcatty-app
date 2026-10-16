"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PluginExtensionProviderService,
  STREAM_WINDOW_BYTES,
} = require("./extensionProviderService.cjs");

function fixture(options = {}) {
  const identity = Object.freeze({
    pluginId: "com.example.transport",
    pluginVersion: "1.0.0",
    runtimeId: "runtime-1",
    runtimeKind: "browser",
    securityPrincipal: "local:com.example.transport",
  });
  const providers = [
    {
      id: "com.example.transport.connection",
      kind: "connection",
      ...(options.connectionConfigurationSchema === undefined
        ? {}
        : { configurationSchema: options.connectionConfigurationSchema }),
    },
    { id: "com.example.transport.auth", kind: "authentication" },
    { id: "com.example.transport.importer", kind: "importer" },
    {
      id: "com.example.transport.sync",
      kind: "sync",
      ...(options.syncConfigurationSchema === undefined
        ? {}
        : { configurationSchema: options.syncConfigurationSchema }),
    },
  ];
  const contributionService = {
    listProviders({ kind }) {
      return providers.filter((provider) => provider.kind === kind).map((provider) => ({
        pluginId: provider.kind === "connection" && options.connectionOwnerPluginId
          ? options.connectionOwnerPluginId
          : identity.pluginId,
        pluginVersion: identity.pluginVersion,
        provider,
      }));
    },
    async activateProvider(providerId) {
      const provider = providers.find((candidate) => candidate.id === providerId);
      if (!provider) throw new Error("missing provider");
      return {
        plugin: {
          id: identity.pluginId,
          activeVersion: identity.pluginVersion,
          manifest: { id: identity.pluginId },
        },
        provider,
        identity,
      };
    },
  };
  const permissions = [];
  const permissionEngine = {
    async authorize(context, descriptor) {
      if (typeof options.authorize === "function") {
        return options.authorize(context, descriptor, permissions);
      }
      permissions.push({ context, descriptor });
      return { scope: "application" };
    },
  };
  const streamHandlers = [];
  const rpcRegistry = {
    registerIncomingStream(handler) { streamHandlers.push(handler); return { dispose() {} }; },
  };
  const runtimeListeners = [];
  const writes = [];
  const issuedLeases = [];
  const revokedOperations = [];
  const leaseStore = {
    issue(params) {
      issuedLeases.push(params);
      return Object.freeze({
        kind: "secret-lease",
        id: "authentication-secret-lease-000000000001",
        operationId: params.operationId,
        expiresAt: Date.now() + (params.ttlMs ?? 30_000),
      });
    },
    revokeOperation(pluginId, operationId) { revokedOperations.push({ pluginId, operationId }); },
  };
  const runtimeSupervisor = {
    onDidChangeRuntime(listener) { runtimeListeners.push(listener); return { dispose() {} }; },
    async request(pluginId, method, params, requestOptions) {
      return options.request({ pluginId, method, params, requestOptions, identity, accept: streamHandlers[0] });
    },
    async openStream(_pluginId, streamId) {
      return {
        async write(bytes) { writes.push([streamId, Buffer.from(bytes)]); },
        async end() { writes.push([streamId, "end"]); },
        cancel() { writes.push([streamId, "cancel"]); },
      };
    },
  };
  const service = new PluginExtensionProviderService({
    contributionService,
    leaseStore,
    permissionEngine,
    rpcRegistry,
    runtimeSupervisor,
    ...(options.maxImportRecordBytes === undefined
      ? {}
      : { maxImportRecordBytes: options.maxImportRecordBytes }),
  });
  return { identity, issuedLeases, permissions, revokedOperations, runtimeListeners, service, writes };
}

function incoming(streamId, emit) {
  return {
    streamId,
    signal: new AbortController().signal,
    bind(handlers) { queueMicrotask(() => emit(handlers)); },
    cancel() {},
  };
}

test("connection providers bind bidirectional streams to an exact runtime and clean up on runtime exit", async () => {
  let h;
  const output = [];
  h = fixture({
    async request({ params, identity, accept }) {
      const stream = incoming(params.payload.outputStreamId, async (handlers) => {
        await handlers.onChunk({ encoding: "binary", bytes: Uint8Array.from([65, 66]) }, () => {});
      });
      assert.equal(await accept(stream, identity), true);
      return {
        requestId: params.requestId,
        status: "ok",
        result: { connectionId: "connection-1", status: "connected" },
      };
    },
  });
  const opened = await h.service.openConnection({
    providerId: "com.example.transport.connection",
    sessionId: "session-1",
    configuration: { endpoint: "example" },
    columns: 120,
    rows: 40,
  }, { onData: (bytes) => output.push(...bytes) });
  assert.deepEqual(opened, {
    sessionId: "session-1",
    providerId: "com.example.transport.connection",
    status: "connected",
    diagnostics: [],
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(output, [65, 66]);
  await h.service.write("session-1", Uint8Array.from([1, 2]));
  assert.deepEqual([...h.writes[0][1]], [1, 2]);
  await h.service.write("session-1", "hello \u4e16\u754c");
  assert.equal(h.writes[1][1].toString("utf8"), "hello \u4e16\u754c");
  assert.equal(h.permissions[0].descriptor.permission, "provider.connection");
  assert.equal(h.revokedOperations.length, 1);
  assert.equal(h.revokedOperations[0].pluginId, h.identity.pluginId);
  assert.match(h.revokedOperations[0].operationId, /^connection:/u);
  h.runtimeListeners[0]({ pluginId: h.identity.pluginId, runtimeId: h.identity.runtimeId, status: "stopped" });
  assert.throws(() => h.service.getSession("session-1"), /not found/i);
});

test("connection terminal input is chunked within the negotiated stream window", async () => {
  let h;
  h = fixture({
    async request({ params, identity, accept }) {
      const stream = incoming(params.payload.outputStreamId, async () => {});
      assert.equal(await accept(stream, identity), true);
      return {
        requestId: params.requestId,
        status: "ok",
        result: { connectionId: "connection-large-input", status: "connected" },
      };
    },
  });
  await h.service.openConnection({
    providerId: "com.example.transport.connection",
    sessionId: "session-large-input",
    configuration: {},
    columns: 80,
    rows: 24,
  });
  const input = Buffer.alloc((STREAM_WINDOW_BYTES * 2) + 3, 0x61);
  await h.service.write("session-large-input", input);

  assert.equal(h.writes.length, 3);
  assert.equal(h.writes[0][0], h.writes[1][0]);
  assert.equal(h.writes[1][0], h.writes[2][0]);
  assert.equal(h.writes[0][1].byteLength, STREAM_WINDOW_BYTES);
  assert.equal(h.writes[1][1].byteLength, STREAM_WINDOW_BYTES);
  assert.equal(h.writes[2][1].byteLength, 3);
});

test("importer detection trims raw samples to the bounded JSON payload budget", async () => {
  const maxProviderJsonBytes = 128 * 1024;
  let seenPayload;
  const h = fixture({
    async request({ params }) {
      seenPayload = params.payload;
      return {
        requestId: params.requestId,
        status: "ok",
        result: { confidence: 0.75, format: "json" },
      };
    },
  });
  const sample = Buffer.alloc(maxProviderJsonBytes, 0x61);

  assert.deepEqual(await h.service.detectImporter({
    providerId: "com.example.transport.importer",
    fileName: "vault-export.json",
    mediaType: "application/json",
    sample,
  }), { confidence: 0.75, format: "json" });

  assert.ok(seenPayload);
  assert.equal(seenPayload.fileName, "vault-export.json");
  assert.equal(seenPayload.mediaType, "application/json");
  assert.ok(Buffer.byteLength(JSON.stringify(seenPayload), "utf8") <= maxProviderJsonBytes);
  const decoded = Buffer.from(seenPayload.sample.data, "base64");
  assert.ok(decoded.byteLength > 0);
  assert.ok(decoded.byteLength < sample.byteLength);
});

test("connection controls preserve host-owned connection and operation identities", async () => {
  let h;
  const controls = [];
  h = fixture({
    async request({ params, identity, accept }) {
      if (params.operation === "open") {
        const stream = incoming(params.payload.outputStreamId, async () => {});
        assert.equal(await accept(stream, identity), true);
        return {
          requestId: params.requestId,
          status: "ok",
          result: { connectionId: "provider-connection-1", status: "connected" },
        };
      }
      controls.push(params);
      return { requestId: params.requestId, status: "ok", result: null };
    },
  });
  await h.service.openConnection({
    providerId: "com.example.transport.connection",
    sessionId: "session-control",
    configuration: {},
    columns: 80,
    rows: 24,
  });
  await h.service.control("session-control", "resize", {
    connectionId: "renderer-forged-connection",
    operationId: "renderer-forged-operation",
    columns: 100,
    rows: 30,
  });
  assert.equal(controls.length, 1);
  assert.equal(controls[0].payload.connectionId, "provider-connection-1");
  assert.notEqual(controls[0].payload.operationId, "renderer-forged-operation");
  assert.match(controls[0].payload.operationId, /^connection:resize:/u);
  assert.deepEqual(h.revokedOperations.at(-1), {
    pluginId: h.identity.pluginId,
    operationId: controls[0].payload.operationId,
  });
});

test("connection control operations must acknowledge with null", async () => {
  for (const operation of ["resize", "signal", "reconnect", "close"]) {
    let h;
    h = fixture({
      async request({ params, identity, accept }) {
        if (params.operation === "open") {
          const stream = incoming(params.payload.outputStreamId, async () => {});
          assert.equal(await accept(stream, identity), true);
          return {
            requestId: params.requestId,
            status: "ok",
            result: { connectionId: `provider-${operation}`, status: "connected" },
          };
        }
        return {
          requestId: params.requestId,
          status: "ok",
          result: { unexpected: true },
        };
      },
    });
    await h.service.openConnection({
      providerId: "com.example.transport.connection",
      sessionId: `session-${operation}`,
      configuration: {},
      columns: 80,
      rows: 24,
    });
    await assert.rejects(
      h.service.control(`session-${operation}`, operation, operation === "resize"
        ? { columns: 100, rows: 30 }
        : operation === "signal"
          ? { signal: "interrupt" }
          : {}),
      /must be null|failed validation/i,
    );
    if (operation === "close") {
      assert.throws(() => h.service.getSession(`session-${operation}`), /not found/i);
    } else {
      assert.ok(h.service.getSession(`session-${operation}`));
    }
  }
});

test("stale connection owners cannot close a same-ID replacement", () => {
  const h = fixture({ async request() { throw new Error("not used"); } });
  const oldOwner = Symbol("old-owner");
  const newOwner = Symbol("new-owner");
  const cancelled = [];
  h.service.sessions.set("session-replaced", {
    sessionOwner: newOwner,
    input: { cancel() { cancelled.push("input"); } },
    output: { cancel() { cancelled.push("output"); } },
  });

  assert.equal(h.service.closeSessionLocal("session-replaced", undefined, oldOwner), false);
  assert.throws(() => h.service.getSession("session-replaced", oldOwner), /replaced/i);
  assert.equal(h.service.getSession("session-replaced", newOwner).sessionOwner, newOwner);
  assert.equal(h.service.closeSessionLocal("session-replaced", undefined, newOwner), true);
  assert.deepEqual(cancelled, ["input", "output"]);
});

test("a same-ID replacement can open while the previous Provider close is pending", async () => {
  let releaseClose;
  const closeGate = new Promise((resolve) => { releaseClose = resolve; });
  let openCount = 0;
  let h;
  h = fixture({
    async request({ params, identity, accept }) {
      if (params.operation === "open") {
        openCount += 1;
        const stream = incoming(params.payload.outputStreamId, async () => {});
        assert.equal(await accept(stream, identity), true);
        return {
          requestId: params.requestId,
          status: "ok",
          result: { connectionId: `provider-replacement-${openCount}`, status: "connected" },
        };
      }
      assert.equal(params.operation, "close");
      await closeGate;
      return { requestId: params.requestId, status: "ok", result: null };
    },
  });
  const oldOwner = Symbol("old-owner");
  const newOwner = Symbol("new-owner");
  const params = {
    providerId: "com.example.transport.connection",
    sessionId: "session-fast-reconnect",
    configuration: {},
    columns: 80,
    rows: 24,
  };

  await h.service.openConnection(params, { sessionOwner: oldOwner });
  const closing = h.service.control(params.sessionId, "close", {}, { sessionOwner: oldOwner });
  assert.throws(() => h.service.getSession(params.sessionId, oldOwner), /not found/i);

  await h.service.openConnection(params, { sessionOwner: newOwner });
  assert.equal(h.service.getSession(params.sessionId, newOwner).sessionOwner, newOwner);

  releaseClose();
  await closing;
  assert.equal(h.service.getSession(params.sessionId, newOwner).sessionOwner, newOwner);
});

test("connection status results preserve structured diagnostics", async () => {
  let h;
  h = fixture({
    async request({ params, identity, accept }) {
      if (params.operation === "open") {
        const stream = incoming(params.payload.outputStreamId, async () => {});
        assert.equal(await accept(stream, identity), true);
        return {
          requestId: params.requestId,
          status: "ok",
          result: { connectionId: "provider-status-diagnostics", status: "connected" },
        };
      }
      return {
        requestId: params.requestId,
        status: "ok",
        result: {
          status: "error",
          message: "Handshake rejected",
          diagnostics: [{ severity: "error", message: "Remote rejected host key" }],
        },
      };
    },
  });
  await h.service.openConnection({
    providerId: "com.example.transport.connection",
    sessionId: "session-status-diagnostics",
    configuration: {},
    columns: 80,
    rows: 24,
  });
  assert.deepEqual(await h.service.control("session-status-diagnostics", "getStatus"), {
    status: "error",
    message: "Handshake rejected",
    diagnostics: [{ severity: "error", message: "Remote rejected host key" }],
  });
});

test("connection configuration is host-validated before invoking plugin code", async () => {
  let requests = 0;
  const h = fixture({
    connectionConfigurationSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string", minLength: 1, maxLength: 64 },
      },
      required: ["endpoint"],
      additionalProperties: false,
    },
    async request() {
      requests += 1;
      throw new Error("plugin code must not run for invalid configuration");
    },
  });
  await assert.rejects(h.service.invoke({
    kind: "connection",
    providerId: "com.example.transport.connection",
    operation: "validateConfiguration",
    payload: { configuration: { endpoint: "", undeclared: true } },
  }), /host schema validation/i);
  assert.equal(requests, 0);
});

test("connection and authentication providers preserve explicit null configuration", async () => {
  let h;
  const seen = [];
  h = fixture({
    connectionConfigurationSchema: { type: "null" },
    async request({ params, identity, accept }) {
      seen.push({ kind: params.kind, operation: params.operation, configuration: params.payload.configuration });
      if (params.kind === "connection") {
        const stream = incoming(params.payload.outputStreamId, async () => {});
        assert.equal(await accept(stream, identity), true);
        return {
          requestId: params.requestId,
          status: "ok",
          result: { connectionId: "connection-null", status: "connected" },
        };
      }
      return {
        requestId: params.requestId,
        status: "ok",
        result: {
          status: "authenticated",
          credential: { kind: "credential", id: "credential-null-reference-1234" },
        },
      };
    },
  });

  await h.service.openConnection({
    providerId: "com.example.transport.connection",
    sessionId: "session-null",
    configuration: null,
    columns: 80,
    rows: 24,
  });
  await h.service.authenticate({
    providerId: "com.example.transport.auth",
    connectionProviderId: "com.example.transport.connection",
    configuration: null,
  }, () => {
    throw new Error("challenge renderer must not run");
  });

  assert.deepEqual(seen.map((entry) => entry.configuration), [null, null]);
});

test("authentication secret challenges enter the runtime only as operation-bound one-use leases", async () => {
  const responses = [];
  const h = fixture({
    async request({ params }) {
      if (params.operation === "begin") {
        return {
          requestId: params.requestId,
          status: "ok",
          result: { status: "challenge", challenge: { id: "otp", kind: "otp", title: "One-time code" } },
        };
      }
      responses.push(params.payload.response);
      return {
        requestId: params.requestId,
        status: "ok",
        result: { status: "authenticated", credential: { kind: "credential", id: "credential-reference-1234" } },
      };
    },
  });
  const result = await h.service.authenticate({
    providerId: "com.example.transport.auth",
    connectionProviderId: "com.example.transport.connection",
    configuration: {},
  }, async (challenge) => {
    assert.equal(challenge.kind, "otp");
    return "123456";
  });
  assert.equal(result.status, "authenticated");
  assert.equal(responses.length, 1);
  assert.equal(responses[0].kind, "secret-lease");
  assert.equal(typeof responses[0].id, "string");
  assert.equal(h.issuedLeases.length, 1);
  assert.equal(h.issuedLeases[0].pluginId, h.identity.pluginId);
  assert.equal(h.issuedLeases[0].runtimeId, h.identity.runtimeId);
  assert.equal(h.issuedLeases[0].operationId, responses[0].operationId);
  assert.deepEqual(h.issuedLeases[0].credential, {
    kind: "authentication-challenge",
    challengeId: "otp",
  });
  assert.equal(h.issuedLeases[0].resolveSecret(), "123456");
  assert.deepEqual(h.revokedOperations, [{
    pluginId: h.identity.pluginId,
    operationId: responses[0].operationId,
  }]);
  assert.equal(h.permissions[0].descriptor.permission, "provider.authentication");
});

test("authentication providers fail closed on malformed nested challenge contracts", async () => {
  const h = fixture({
    async request({ params }) {
      return {
        requestId: params.requestId,
        status: "ok",
        result: {
          status: "challenge",
          challenge: { id: "choice", kind: "choice", title: "Choose", choices: [{ label: "Missing value" }] },
        },
      };
    },
  });
  await assert.rejects(h.service.authenticate({
    providerId: "com.example.transport.auth",
    connectionProviderId: "com.example.transport.connection",
    configuration: {},
  }, async () => "unused"), /failed validation|challenge/i);
});

test("authentication cancellation reaches the provider with a fresh bounded signal", async () => {
  const controller = new AbortController();
  const operations = [];
  const h = fixture({
    async request({ params, requestOptions }) {
      operations.push(params.operation);
      if (params.operation === "begin") {
        return {
          requestId: params.requestId,
          status: "ok",
          result: {
            status: "challenge",
            challenge: { id: "password", kind: "password", title: "Password" },
          },
        };
      }
      assert.equal(params.operation, "cancel");
      assert.equal(requestOptions.signal.aborted, false);
      assert.equal(params.deadlineMs, 1_000);
      return { requestId: params.requestId, status: "ok", result: { status: "cancelled" } };
    },
  });

  await assert.rejects(h.service.authenticate({
    providerId: "com.example.transport.auth",
    connectionProviderId: "com.example.transport.connection",
    configuration: {},
  }, async () => {
    controller.abort(new DOMException("Cancelled", "AbortError"));
    throw controller.signal.reason;
  }, { signal: controller.signal }), (error) => error?.name === "AbortError");
  assert.deepEqual(operations, ["begin", "cancel"]);
});

test("authentication text responses use the public Unicode code-point limit", async () => {
  const response = "😀".repeat(8_192);
  const h = fixture({
    async request({ params }) {
      if (params.operation === "begin") {
        return {
          requestId: params.requestId,
          status: "ok",
          result: {
            status: "challenge",
            challenge: { id: "text", kind: "text", title: "Input" },
          },
        };
      }
      assert.equal(params.operation, "respond");
      assert.equal(params.payload.response, response);
      return { requestId: params.requestId, status: "ok", result: { status: "authenticated" } };
    },
  });

  const result = await h.service.authenticate({
    providerId: "com.example.transport.auth",
    connectionProviderId: "com.example.transport.connection",
    configuration: {},
  }, async () => response);
  assert.equal(result.status, "authenticated");
});

test("authentication responses are host-validated against the exact challenge before plugin delivery", async () => {
  const operations = [];
  const h = fixture({
    async request({ params }) {
      operations.push(params.operation);
      if (params.operation === "begin") {
        return {
          requestId: params.requestId,
          status: "ok",
          result: {
            status: "challenge",
            challenge: {
              id: "choice",
              kind: "choice",
              title: "Choose",
              choices: [{ id: "allowed", label: "Allowed" }],
            },
          },
        };
      }
      return {
        requestId: params.requestId,
        status: "ok",
        result: { status: "cancelled" },
      };
    },
  });
  await assert.rejects(h.service.authenticate({
    providerId: "com.example.transport.auth",
    connectionProviderId: "com.example.transport.connection",
    configuration: {},
  }, async () => "undeclared-choice"), /choice response is invalid/i);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(operations, ["begin", "cancel"]);
});

test("cross-plugin authentication cannot transfer a plugin-owned secret reference", async () => {
  const h = fixture({
    connectionOwnerPluginId: "org.example.connection",
    async request({ params }) {
      if (params.operation === "cancel") {
        return { requestId: params.requestId, status: "ok", result: { status: "cancelled" } };
      }
      return {
        requestId: params.requestId,
        status: "ok",
        result: {
          status: "authenticated",
          credential: { kind: "secret", id: "plugin-secret-reference-0001", key: "token" },
        },
      };
    },
  });
  await assert.rejects(h.service.authenticate({
    providerId: "com.example.transport.auth",
    connectionProviderId: "com.example.transport.connection",
    configuration: {},
  }, async () => true), /host-owned CredentialRef/i);
});

test("importer providers produce a validated preview without mutating Vault state", async () => {
  let h;
  const jsonl = [
    JSON.stringify({ type: "progress", completed: 1, total: 2, message: "Reading source" }),
    JSON.stringify({
      type: "draft",
      draft: { kind: "host", value: { label: "Imported", hostname: "imported.example.com" } },
    }),
    JSON.stringify({ type: "warning", message: "Missing optional color" }),
    "",
  ].join("\n");
  h = fixture({
    async request({ params, identity, accept }) {
      const stream = incoming(params.payload.outputStreamId, async (handlers) => {
        await handlers.onChunk({ encoding: "binary", bytes: new TextEncoder().encode(jsonl) }, () => {});
        await handlers.onClose("end");
      });
      assert.equal(await accept(stream, identity), true);
      await new Promise((resolve) => setImmediate(resolve));
      return {
        requestId: params.requestId,
        status: "ok",
        result: { parsed: 1, warnings: 1, errors: 0 },
      };
    },
  });
  const progress = [];
  const preview = await h.service.parseImporter({
    providerId: "com.example.transport.importer",
    fileName: "hosts.json",
    sourceByteLength: 6,
    source: (async function* source() {
      yield new TextEncoder().encode("sou");
      yield new TextEncoder().encode("rce");
    }()),
  }, { onProgress: (record) => progress.push(record) });
  assert.equal(preview.records.length, 3);
  assert.equal(preview.records[0].type, "progress");
  assert.equal(preview.records[1].type, "draft");
  assert.equal(preview.records[2].type, "warning");
  assert.deepEqual(progress, [{ type: "progress", completed: 1, total: 2, message: "Reading source" }]);
  assert.equal(preview.result.parsed, 1);
  assert.equal(Buffer.concat(h.writes.filter(([, value]) => Buffer.isBuffer(value)).map(([, value]) => value)).toString(), "source");
  assert.equal(h.writes.at(-1)[1], "end");
  assert.equal(h.permissions[0].descriptor.permission, "provider.importer");
  assert.equal(h.revokedOperations.length, 1);
  assert.equal(h.revokedOperations[0].pluginId, h.identity.pluginId);
  assert.match(h.revokedOperations[0].operationId, /^importer:/u);
});

test("import parsing rejects an unterminated JSONL record as soon as it exceeds the line cap", async () => {
  let h;
  h = fixture({
    maxImportRecordBytes: 256 * 1024,
    async request({ params, identity, accept }) {
      const stream = incoming(params.payload.outputStreamId, async (handlers) => {
        const first = new Uint8Array(192 * 1024).fill(0x61);
        const second = new Uint8Array(65 * 1024).fill(0x62);
        await handlers.onChunk({ encoding: "binary", bytes: first }, () => {});
        assert.throws(
          () => handlers.onChunk({ encoding: "binary", bytes: second }, () => {}),
          /record limits/i,
        );
      });
      assert.equal(await accept(stream, identity), true);
      return {
        requestId: params.requestId,
        status: "ok",
        result: { parsed: 0, warnings: 0, errors: 0 },
      };
    },
  });
  await assert.rejects(h.service.parseImporter({
    providerId: "com.example.transport.importer",
    fileName: "hosts.json",
    data: new TextEncoder().encode("source"),
  }), /record limits/i);
  assert.equal(h.revokedOperations.length, 1);
  assert.match(h.revokedOperations[0].operationId, /^importer:/u);
});

test("import parsing accepts public records larger than the old private line limit", async () => {
  let h;
  const jsonl = `${JSON.stringify({
    type: "draft",
    draft: {
      kind: "snippet",
      value: { label: "Large snippet", command: "x".repeat(300_000) },
    },
  })}\n`;
  h = fixture({
    async request({ params, identity, accept }) {
      const stream = incoming(params.payload.outputStreamId, async (handlers) => {
        await handlers.onChunk({ encoding: "binary", bytes: new TextEncoder().encode(jsonl) }, () => {});
        await handlers.onClose("end");
      });
      assert.equal(await accept(stream, identity), true);
      await new Promise((resolve) => setImmediate(resolve));
      return {
        requestId: params.requestId,
        status: "ok",
        result: { parsed: 1, warnings: 0, errors: 0 },
      };
    },
  });

  const preview = await h.service.parseImporter({
    providerId: "com.example.transport.importer",
    data: new TextEncoder().encode("source"),
  });
  assert.equal(preview.records[0].type, "draft");
  assert.equal(preview.records[0].draft.value.command.length, 300_000);
});

test("importer input streams fail closed if the selected file changes size", async () => {
  let h;
  h = fixture({
    async request({ params, identity, accept }) {
      const stream = incoming(params.payload.outputStreamId, async (handlers) => {
        await handlers.onClose("end");
      });
      assert.equal(await accept(stream, identity), true);
      return {
        requestId: params.requestId,
        status: "ok",
        result: { parsed: 0, warnings: 0, errors: 0 },
      };
    },
  });
  await assert.rejects(h.service.parseImporter({
    providerId: "com.example.transport.importer",
    sourceByteLength: 5,
    source: (async function* source() { yield new TextEncoder().encode("changed"); }()),
  }), /changed while it was being read|unexpected size/i);
  assert.equal(h.revokedOperations.length, 1);
  assert.match(h.revokedOperations[0].operationId, /^importer:/u);
});

test("importer providers cannot report completion counts that disagree with the bounded stream", async () => {
  let h;
  h = fixture({
    async request({ params, identity, accept }) {
      const stream = incoming(params.payload.outputStreamId, async (handlers) => {
        await handlers.onChunk({
          encoding: "binary",
          bytes: new TextEncoder().encode(`${JSON.stringify({ type: "warning", message: "one" })}\n`),
        }, () => {});
        await handlers.onClose("end");
      });
      assert.equal(await accept(stream, identity), true);
      await new Promise((resolve) => setImmediate(resolve));
      return {
        requestId: params.requestId,
        status: "ok",
        result: { parsed: 1, warnings: 0, errors: 0 },
      };
    },
  });
  await assert.rejects(h.service.parseImporter({
    providerId: "com.example.transport.importer",
    fileName: "hosts.json",
    data: new TextEncoder().encode("source"),
  }), /counts do not match/i);
});

test("unsolicited plugin streams are not claimed by the extension Provider service", async () => {
  const h = fixture({ request() { throw new Error("unused"); } });
  const accepted = await h.service.acceptIncomingStream({ streamId: "unsolicited" }, h.identity);
  assert.equal(accepted, false);
});

test("connection startup reports a provider rejection without waiting for the output-stream deadline", async () => {
  const h = fixture({
    async request() {
      throw new Error("provider rejected open");
    },
  });
  await assert.rejects(h.service.openConnection({
    providerId: "com.example.transport.connection",
    sessionId: "session-rejected",
    configuration: {},
    columns: 80,
    rows: 24,
    deadlineMs: 300_000,
  }), /provider rejected open/);
  assert.equal(h.service.expectations.size, 0);
});

test("import parsing reports a provider rejection without waiting for the output-stream deadline", async () => {
  let sourceReturned = false;
  const h = fixture({
    async request() {
      throw new Error("provider rejected parse");
    },
  });
  const source = {
    [Symbol.asyncIterator]() { return this; },
    next() { return Promise.resolve({ value: new TextEncoder().encode("source"), done: false }); },
    return() { sourceReturned = true; return Promise.resolve({ done: true }); },
  };
  await assert.rejects(h.service.parseImporter({
    providerId: "com.example.transport.importer",
    fileName: "hosts.json",
    source,
    sourceByteLength: 6,
    deadlineMs: 300_000,
  }), /provider rejected parse/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sourceReturned, true);
  assert.equal(h.service.expectations.size, 0);
});

test("import parsing enforces its deadline when a successful provider forgets to end output", async () => {
  let h;
  h = fixture({
    async request({ params, identity, accept }) {
      const stream = incoming(params.payload.outputStreamId, async () => {});
      assert.equal(await accept(stream, identity), true);
      return {
        requestId: params.requestId,
        status: "ok",
        result: { parsed: 0, warnings: 0, errors: 0 },
      };
    },
  });
  await assert.rejects(h.service.parseImporter({
    providerId: "com.example.transport.importer",
    fileName: "hosts.json",
    data: new TextEncoder().encode("source"),
    deadlineMs: 25,
  }), /output stream exceeded its deadline/i);
  assert.equal(h.revokedOperations.length, 1);
  assert.match(h.revokedOperations[0].operationId, /^importer:/u);
});

test("import parsing enforces its deadline while the selected input source stalls", async () => {
  let h;
  let sourceReturned = false;
  h = fixture({
    async request({ params, identity, accept }) {
      const stream = incoming(params.payload.outputStreamId, async () => {});
      assert.equal(await accept(stream, identity), true);
      return new Promise(() => {});
    },
  });
  const source = {
    [Symbol.asyncIterator]() { return this; },
    next() { return new Promise(() => {}); },
    return() { sourceReturned = true; return Promise.resolve({ done: true }); },
  };
  await assert.rejects(h.service.parseImporter({
    providerId: "com.example.transport.importer",
    fileName: "hosts.json",
    source,
    sourceByteLength: 6,
    deadlineMs: 25,
  }), /input source exceeded its deadline/i);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sourceReturned, true);
  assert.equal(h.revokedOperations.length, 1);
});

test("sync providers require provider.sync and only exchange encrypted object bytes", async () => {
  const cipher = Buffer.from([0x9b, 0x01, 0x02, 0x03]);
  let writePayload;
  const h = fixture({
    async request({ params }) {
      assert.equal(params.kind, "sync");
      if (params.operation === "connect") {
        return {
          requestId: params.requestId,
          status: "ok",
          result: { account: { id: "acct-1", name: "Plugin Sync" } },
        };
      }
      if (params.operation === "getCapabilities") {
        return {
          requestId: params.requestId,
          status: "ok",
          result: {
            revisions: true,
            conditionalWrites: true,
            atomicReplacement: true,
            maxObjectBytes: 1024,
          },
        };
      }
      if (params.operation === "readObject") {
        assert.equal(params.payload.key, "netcatty-vault.json");
        assert.equal(typeof params.payload.outputStreamId, "string");
        return {
          requestId: params.requestId,
          status: "ok",
          result: {
            found: true,
            byteLength: cipher.byteLength,
            encoding: "base64",
            data: cipher.toString("base64"),
            revision: "rev-1",
          },
        };
      }
      if (params.operation === "writeObject") {
        writePayload = params.payload;
        assert.equal(params.payload.key, "netcatty-vault.json");
        assert.equal(params.payload.encoding, "base64");
        assert.equal(Buffer.from(params.payload.data, "base64").equals(cipher), true);
        return {
          requestId: params.requestId,
          status: "ok",
          result: { created: true, revision: "rev-2" },
        };
      }
      if (params.operation === "deleteObject") {
        return {
          requestId: params.requestId,
          status: "ok",
          result: { deleted: true },
        };
      }
      if (params.operation === "disconnect") {
        return { requestId: params.requestId, status: "ok", result: null };
      }
      throw new Error(`unexpected operation ${params.operation}`);
    },
  });

  const connected = await h.service.connectSync({
    providerId: "com.example.transport.sync",
    configuration: { endpoint: "https://example.test" },
  });
  assert.equal(connected.account.id, "acct-1");
  assert.equal(h.permissions[0].descriptor.permission, "provider.sync");

  const caps = await h.service.getSyncCapabilities({
    providerId: "com.example.transport.sync",
  });
  assert.equal(caps.conditionalWrites, true);

  const read = await h.service.readSyncObject({
    providerId: "com.example.transport.sync",
    key: "netcatty-vault.json",
  });
  assert.equal(read.found, true);
  assert.equal(Buffer.from(read.bytes).equals(cipher), true);
  assert.equal(read.revision, "rev-1");

  const written = await h.service.writeSyncObject({
    providerId: "com.example.transport.sync",
    key: "netcatty-vault.json",
    bytes: cipher,
  });
  assert.equal(written.created, true);
  assert.equal(written.revision, "rev-2");
  assert.equal(writePayload.byteLength, cipher.byteLength);

  const deleted = await h.service.deleteSyncObject({
    providerId: "com.example.transport.sync",
    key: "netcatty-vault.json",
  });
  assert.equal(deleted.deleted, true);

  const disconnected = await h.service.disconnectSync({
    providerId: "com.example.transport.sync",
  });
  assert.equal(disconnected, null);
});

test("sync providers fail closed without provider.sync permission", async () => {
  const { PluginRpcError, RPC_ERRORS } = require("./rpcRouter.cjs");
  const h = fixture({
    async request() {
      throw new Error("plugin should not be invoked");
    },
    async authorize() {
      throw new PluginRpcError(RPC_ERRORS.permissionDenied, "missing provider.sync");
    },
  });
  await assert.rejects(h.service.connectSync({
    providerId: "com.example.transport.sync",
    configuration: {},
  }), /provider\.sync|permission/i);
});

test("sync writeObject streams large encrypted objects outside the JSON budget", async () => {
  const { INLINE_SYNC_OBJECT_BYTES } = require("./extensionProviderService.cjs");
  const large = Buffer.alloc(INLINE_SYNC_OBJECT_BYTES + 16, 0xab);
  let sawStream = false;
  const h = fixture({
    async request({ params }) {
      assert.equal(params.operation, "writeObject");
      assert.equal(typeof params.payload.inputStreamId, "string");
      assert.equal(params.payload.data, undefined);
      sawStream = true;
      return {
        requestId: params.requestId,
        status: "ok",
        result: { created: false, revision: "stream-rev" },
      };
    },
  });
  const result = await h.service.writeSyncObject({
    providerId: "com.example.transport.sync",
    key: "netcatty-vault.json",
    bytes: large,
  });
  assert.equal(sawStream, true);
  assert.equal(result.revision, "stream-rev");
  assert.ok(h.writes.some((entry) => entry[1] === "end"));
});
