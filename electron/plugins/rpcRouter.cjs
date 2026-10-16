"use strict";

const { randomUUID } = require("node:crypto");

const {
  PLUGIN_RPC_DEFAULT_TIMEOUT_MS,
  PLUGIN_RPC_MAX_PENDING,
} = require("./constants.cjs");
const {
  assertInitializeResult,
  assertRpcMessage,
  assertStreamFrameSchema,
} = require("./contractValidator.cjs");
const { PluginStreamRouter, assertStreamEnvelopeShape } = require("./streamRouter.cjs");

const RPC_ERRORS = Object.freeze({
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  cancelled: -32001,
  invalidArgument: -32003,
  deadlineExceeded: -32004,
  notFound: -32005,
  alreadyExists: -32006,
  permissionDenied: -32007,
  resourceExhausted: -32008,
  failedPrecondition: -32009,
  aborted: -32010,
  outOfRange: -32011,
  unsupported: -32012,
  unavailable: -32014,
  dataLoss: -32015,
  unauthenticated: -32016,
});

class PluginRpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = "PluginRpcError";
    this.code = code;
    this.data = data;
  }
}

function rpcIdKey(id) {
  return `${typeof id}:${String(id)}`;
}

function toRpcError(error) {
  if (error instanceof PluginRpcError) {
    return {
      code: error.code,
      message: error.message.slice(0, 2_048) || "Plugin RPC failed",
      ...(error.data === undefined ? {} : { data: error.data }),
    };
  }
  return { code: RPC_ERRORS.internal, message: "Plugin host request failed" };
}

function raceWithAbort(operation, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

class PluginRpcRouter {
  constructor(options) {
    this.pluginId = options.pluginId;
    this.send = options.send;
    const legacyHandlers = options.handlers ?? {};
    this.requestHandlers = new Map(Object.entries(options.requestHandlers ?? legacyHandlers));
    this.notificationHandlers = new Map(Object.entries(options.notificationHandlers ?? legacyHandlers));
    this.pending = new Map();
    this.pendingCancellationIds = new Set();
    this.retiredResponseIds = new Set();
    this.inflight = new Map();
    this.inflightIds = new Set();
    this.inflightNotifications = new Set();
    this.nextId = 0;
    this.closed = false;
    this.maxPending = options.maxPending ?? PLUGIN_RPC_MAX_PENDING;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? PLUGIN_RPC_DEFAULT_TIMEOUT_MS;
    this.onProtocolError = options.onProtocolError ?? (() => {});
    this.onBeforeMessage = options.onBeforeMessage ?? (() => {});
    if (typeof this.onBeforeMessage !== "function") {
      throw new TypeError("Plugin RPC message guard must be a function");
    }
    this.progress = options.onProgress ?? (() => {});
    this.streams = new PluginStreamRouter({
      send: (message, transfer) => this.send(message, transfer),
      onIncomingStream: options.onIncomingStream,
      maxStreams: this.maxPending,
      openTimeoutMs: this.defaultTimeoutMs,
    });
    this.streamChains = new Map();
  }

  #sendRpc(message, transfer = []) {
    assertRpcMessage(message);
    if (!Array.isArray(transfer)) {
      throw new TypeError("Plugin RPC transfer list must be an array");
    }
    this.send(message, transfer);
  }

  #sendFailure(id, error) {
    try {
      this.#sendRpc({ jsonrpc: "2.0", id, error: toRpcError(error) });
    } catch {
      this.#sendRpc({
        jsonrpc: "2.0",
        id,
        error: { code: RPC_ERRORS.internal, message: "Plugin host request failed" },
      });
    }
  }

  #allocateRequestId() {
    for (let attempt = 0; attempt <= this.maxPending + this.retiredResponseIds.size; attempt += 1) {
      const id = this.nextId;
      this.nextId = this.nextId === Number.MAX_SAFE_INTEGER ? 0 : this.nextId + 1;
      const key = rpcIdKey(id);
      if (!this.pending.has(key) && !this.retiredResponseIds.has(key)) return id;
    }
    throw new PluginRpcError(RPC_ERRORS.resourceExhausted, "No RPC correlation ID is available");
  }

  #allocateCancellationId() {
    let cancellationId;
    do cancellationId = `host-${randomUUID()}`;
    while (this.pendingCancellationIds.has(cancellationId));
    return cancellationId;
  }

  #forgetPending(id, pending) {
    this.pending.delete(rpcIdKey(id));
    this.pendingCancellationIds.delete(pending.cancellationId);
    clearTimeout(pending.timer);
    pending.abortCleanup?.();
  }

  #retireResponseId(id) {
    const key = rpcIdKey(id);
    this.retiredResponseIds.delete(key);
    this.retiredResponseIds.add(key);
    while (this.retiredResponseIds.size > this.maxPending) {
      this.retiredResponseIds.delete(this.retiredResponseIds.values().next().value);
    }
  }

  accept(rawMessage) {
    return this.#accept(rawMessage)
      .catch((error) => {
        if (this.closed) return;
        this.onProtocolError(error);
        this.close(error);
      });
  }

  async #accept(rawMessage) {
    if (this.closed) return;
    const guardResult = this.onBeforeMessage(rawMessage);
    if (guardResult && typeof guardResult.then === "function") {
      void Promise.resolve(guardResult).catch(() => {});
      throw new TypeError("Plugin RPC message guard must be synchronous");
    }
    const message = rawMessage;
    if (message && typeof message === "object" && Object.hasOwn(message, "frame")) {
      assertStreamEnvelopeShape(message);
      assertStreamFrameSchema(message.frame);
      const streamId = message.frame.streamId;
      const previous = this.streamChains.get(streamId) ?? Promise.resolve();
      const current = previous.then(() => this.streams.accept(message));
      this.streamChains.set(streamId, current);
      try {
        await current;
      } finally {
        if (this.streamChains.get(streamId) === current) this.streamChains.delete(streamId);
      }
      return;
    }
    assertRpcMessage(message);
    if (Object.hasOwn(message, "id") && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) {
      this.#acceptResponse(message);
      return;
    }
    if (message.method === "$/progress") {
      this.progress(message.params);
      return;
    }
    if (message.method === "$/cancelRequest") {
      this.#cancelInflight(message.params.cancellationId);
      return;
    }
    if (Object.hasOwn(message, "id")) {
      await this.#acceptRequest(message);
      return;
    }
    await this.#acceptNotification(message);
  }

  #acceptResponse(message) {
    const key = rpcIdKey(message.id);
    const pending = this.pending.get(key);
    if (!pending) {
      if (this.retiredResponseIds.delete(key)) return;
      throw new Error(`Plugin returned an unknown RPC response ID: ${String(message.id)}`);
    }
    this.#forgetPending(message.id, pending);
    if (Object.hasOwn(message, "error")) {
      pending.reject(new PluginRpcError(message.error.code, message.error.message, message.error.data));
      return;
    }
    try {
      let result = pending.method === "plugin.initialize"
        ? assertInitializeResult(message.result)
        : message.result;
      if (pending.validateResult) result = pending.validateResult(result);
      pending.resolve(result);
    } catch (error) {
      pending.reject(error);
    }
  }

  async #acceptRequest(message) {
    if (this.inflight.size >= this.maxPending) {
      this.#sendRpc({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: RPC_ERRORS.resourceExhausted, message: "Too many in-flight plugin requests" },
      });
      return;
    }
    const handler = this.requestHandlers.get(message.method);
    if (!handler) {
      this.#sendRpc({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: RPC_ERRORS.methodNotFound, message: `Unsupported plugin method: ${message.method}` },
      });
      return;
    }
    const requestIdKey = rpcIdKey(message.id);
    if (this.inflightIds.has(requestIdKey)) {
      this.#sendFailure(message.id, new PluginRpcError(
        RPC_ERRORS.invalidParams,
        "Duplicate in-flight plugin request ID",
      ));
      return;
    }
    let cancellationId = message.cancellationId;
    if (cancellationId && this.inflight.has(cancellationId)) {
      this.#sendFailure(message.id, new PluginRpcError(
        RPC_ERRORS.invalidParams,
        "Duplicate in-flight plugin cancellation ID",
      ));
      return;
    }
    if (!cancellationId) {
      do cancellationId = `host-${randomUUID()}`;
      while (this.inflight.has(cancellationId));
    }
    const controller = new AbortController();
    const timeoutMs = message.deadlineMs ?? this.defaultTimeoutMs;
    const timer = setTimeout(() => controller.abort(new PluginRpcError(
      RPC_ERRORS.deadlineExceeded,
      "Plugin request deadline exceeded",
    )), timeoutMs);
    this.inflight.set(cancellationId, controller);
    this.inflightIds.add(requestIdKey);
    try {
      const result = await raceWithAbort(Promise.resolve(handler(message.params, {
        pluginId: this.pluginId,
        signal: controller.signal,
        cancellationId,
        deadlineMs: timeoutMs,
        requestId: message.id,
      })), controller.signal);
      if (!this.closed) this.#sendRpc({ jsonrpc: "2.0", id: message.id, result: result ?? null });
    } catch (error) {
      if (!this.closed) this.#sendFailure(message.id, error);
    } finally {
      clearTimeout(timer);
      this.inflight.delete(cancellationId);
      this.inflightIds.delete(requestIdKey);
    }
  }

  async #acceptNotification(message) {
    const handler = this.notificationHandlers.get(message.method);
    if (!handler) return;
    if (this.inflightNotifications.size >= this.maxPending) {
      throw new PluginRpcError(RPC_ERRORS.resourceExhausted, "Too many in-flight plugin notifications");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new PluginRpcError(
      RPC_ERRORS.deadlineExceeded,
      "Plugin notification deadline exceeded",
    )), this.defaultTimeoutMs);
    this.inflightNotifications.add(controller);
    try {
      await raceWithAbort(Promise.resolve(handler(message.params, {
        pluginId: this.pluginId,
        signal: controller.signal,
        notification: true,
      })), controller.signal);
    } finally {
      clearTimeout(timer);
      this.inflightNotifications.delete(controller);
    }
  }

  #cancelInflight(cancellationId) {
    const controller = this.inflight.get(cancellationId);
    controller?.abort(new PluginRpcError(RPC_ERRORS.cancelled, "Plugin request was cancelled"));
  }

  request(method, params, options = {}) {
    if (this.closed) return Promise.reject(new PluginRpcError(RPC_ERRORS.unavailable, "Plugin runtime is closed"));
    if (options.signal?.aborted) {
      return Promise.reject(new PluginRpcError(RPC_ERRORS.cancelled, "Plugin request was cancelled"));
    }
    if (this.pending.size >= this.maxPending) {
      return Promise.reject(new PluginRpcError(RPC_ERRORS.resourceExhausted, "Too many pending plugin requests"));
    }
    const id = this.#allocateRequestId();
    const cancellationId = options.cancellationId ?? this.#allocateCancellationId();
    if (this.pendingCancellationIds.has(cancellationId)) {
      return Promise.reject(new PluginRpcError(
        RPC_ERRORS.invalidParams,
        "Plugin request cancellation ID is already in use",
      ));
    }
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    if (options.validateResult != null && typeof options.validateResult !== "function") {
      return Promise.reject(new TypeError("Plugin RPC result validator must be a function"));
    }
    if (options.transfer != null && !Array.isArray(options.transfer)) {
      return Promise.reject(new TypeError("Plugin RPC transfer list must be an array"));
    }
    const message = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
      deadlineMs: timeoutMs,
      cancellationId,
    };
    assertRpcMessage(message);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(rpcIdKey(id));
        if (pending) {
          this.#retireResponseId(id);
          this.#forgetPending(id, pending);
        }
        try {
          this.#sendRpc({ jsonrpc: "2.0", method: "$/cancelRequest", params: { cancellationId } });
        } catch {}
        reject(new PluginRpcError(RPC_ERRORS.deadlineExceeded, `Plugin request timed out: ${method}`));
      }, timeoutMs);
      let abortCleanup;
      if (options.signal) {
        const onAbort = () => {
          const pending = this.pending.get(rpcIdKey(id));
          if (pending) {
            this.#retireResponseId(id);
            this.#forgetPending(id, pending);
          }
          try {
            this.#sendRpc({ jsonrpc: "2.0", method: "$/cancelRequest", params: { cancellationId } });
          } catch {}
          reject(new PluginRpcError(RPC_ERRORS.cancelled, "Plugin request was cancelled"));
        };
        options.signal.addEventListener("abort", onAbort, { once: true });
        abortCleanup = () => options.signal.removeEventListener("abort", onAbort);
      }
      const pending = {
        method,
        cancellationId,
        resolve,
        reject,
        timer,
        abortCleanup,
        validateResult: options.validateResult,
      };
      this.pending.set(rpcIdKey(id), pending);
      this.pendingCancellationIds.add(cancellationId);
      try {
        this.#sendRpc(message, options.transfer ?? []);
      } catch (error) {
        this.#forgetPending(id, pending);
        reject(error);
      }
    });
  }

  notify(method, params) {
    if (this.closed) throw new PluginRpcError(RPC_ERRORS.unavailable, "Plugin runtime is closed");
    const message = { jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) };
    this.#sendRpc(message);
  }

  close(error = new PluginRpcError(RPC_ERRORS.unavailable, "Plugin runtime closed")) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.abortCleanup?.();
      pending.reject(error);
    }
    this.pending.clear();
    this.pendingCancellationIds.clear();
    this.retiredResponseIds.clear();
    for (const controller of this.inflight.values()) controller.abort(error);
    this.inflight.clear();
    this.inflightIds.clear();
    for (const controller of this.inflightNotifications) controller.abort(error);
    this.inflightNotifications.clear();
    this.streams.close(error);
    this.streamChains.clear();
  }
}

module.exports = { PluginRpcError, PluginRpcRouter, RPC_ERRORS, raceWithAbort, rpcIdKey };
