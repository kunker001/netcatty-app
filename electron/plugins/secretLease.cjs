"use strict";

const { randomBytes } = require("node:crypto");

const { PluginRpcError, RPC_ERRORS } = require("./rpcRouter.cjs");

const DEFAULT_SECRET_LEASE_TTL_MS = 30_000;
const MAX_SECRET_LEASE_TTL_MS = 60_000;
const MAX_SECRET_LEASES_PER_RUNTIME = 128;

function assertLeaseReference(lease) {
  if (
    !lease
    || typeof lease !== "object"
    || Array.isArray(lease)
    || lease.kind !== "secret-lease"
    || typeof lease.id !== "string"
    || lease.id.length < 32
    || lease.id.length > 256
  ) throw new PluginRpcError(RPC_ERRORS.invalidArgument, "Secret lease reference is invalid");
  return lease.id;
}

class SecretLeaseStore {
  constructor(options) {
    this.secretStore = options.secretStore;
    this.clock = options.clock ?? (() => Date.now());
    this.randomBytes = options.randomBytes ?? randomBytes;
    this.setTimer = options.setTimeout ?? setTimeout;
    this.clearTimer = options.clearTimeout ?? clearTimeout;
    this.leases = new Map();
    this.closed = false;
  }

  issue(options) {
    if (this.closed) throw new PluginRpcError(RPC_ERRORS.unavailable, "Secret lease broker is closed");
    if (options.signal?.aborted) {
      throw new PluginRpcError(RPC_ERRORS.cancelled, "Secret lease operation was cancelled");
    }
    const activeCount = [...this.leases.values()].filter((lease) => (
      lease.runtimeId === options.runtimeId
    )).length;
    if (activeCount >= MAX_SECRET_LEASES_PER_RUNTIME) {
      throw new PluginRpcError(RPC_ERRORS.resourceExhausted, "Too many active secret leases");
    }
    const ttlMs = options.ttlMs ?? DEFAULT_SECRET_LEASE_TTL_MS;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_SECRET_LEASE_TTL_MS) {
      throw new PluginRpcError(RPC_ERRORS.invalidArgument, "Secret lease lifetime is invalid");
    }
    const id = this.randomBytes(24).toString("base64url");
    if (options.resolveSecret !== undefined && typeof options.resolveSecret !== "function") {
      throw new TypeError("Secret lease resolver must be a function");
    }
    const credential = options.credential ?? options.secret;
    if (!credential) throw new TypeError("Secret lease credential is required");
    const expiresAt = this.clock() + ttlMs;
    const record = {
      id,
      pluginId: options.pluginId,
      runtimeId: options.runtimeId,
      credential,
      resolveSecret: options.resolveSecret ?? null,
      operationId: options.operationId,
      purpose: options.purpose,
      expiresAt,
      timer: null,
      abortCleanup: null,
    };
    record.timer = this.setTimer(() => this.#delete(id), ttlMs);
    record.timer?.unref?.();
    if (options.signal) {
      const onAbort = () => this.#delete(id);
      options.signal.addEventListener("abort", onAbort, { once: true });
      record.abortCleanup = () => options.signal.removeEventListener("abort", onAbort);
    }
    this.leases.set(id, record);
    if (options.signal?.aborted) {
      this.#delete(id);
      throw new PluginRpcError(RPC_ERRORS.cancelled, "Secret lease operation was cancelled");
    }
    return Object.freeze({
      kind: "secret-lease",
      id,
      operationId: options.operationId,
      expiresAt,
    });
  }

  consume(options) {
    if (options.signal?.aborted) {
      throw new PluginRpcError(RPC_ERRORS.cancelled, "Secret lease operation was cancelled");
    }
    const id = assertLeaseReference(options.lease);
    const record = this.leases.get(id);
    if (!record || record.expiresAt <= this.clock()) {
      this.#delete(id);
      throw new PluginRpcError(RPC_ERRORS.notFound, "Secret lease is missing or expired");
    }
    if (
      record.pluginId !== options.pluginId
      || record.runtimeId !== options.runtimeId
      || record.operationId !== options.operationId
    ) throw new PluginRpcError(RPC_ERRORS.permissionDenied, "Secret lease scope does not match the operation");
    this.#delete(id);
    const consumeContext = Object.freeze({
      pluginId: record.pluginId,
      runtimeId: record.runtimeId,
      operationId: record.operationId,
      credential: record.credential,
      signal: options.signal,
    });
    const resolved = record.resolveSecret
      ? record.resolveSecret(consumeContext)
      : this.secretStore.resolve(record.pluginId, record.credential);
    if (!resolved || typeof resolved.then !== "function") {
      if (options.signal?.aborted) {
        throw new PluginRpcError(RPC_ERRORS.cancelled, "Secret lease operation was cancelled");
      }
      return resolved;
    }
    return Promise.resolve(resolved).then((value) => {
      if (options.signal?.aborted) {
        throw new PluginRpcError(RPC_ERRORS.cancelled, "Secret lease operation was cancelled");
      }
      return value;
    });
  }

  #delete(id) {
    const record = this.leases.get(id);
    if (!record) return false;
    this.leases.delete(id);
    this.clearTimer(record.timer);
    record.abortCleanup?.();
    return true;
  }

  revokeRuntime(runtimeId) {
    for (const [id, lease] of [...this.leases]) {
      if (lease.runtimeId === runtimeId) this.#delete(id);
    }
  }

  revokeOperation(pluginId, operationId) {
    for (const [id, lease] of [...this.leases]) {
      if (lease.pluginId === pluginId && lease.operationId === operationId) this.#delete(id);
    }
  }

  shutdown() {
    this.closed = true;
    for (const id of [...this.leases.keys()]) this.#delete(id);
  }
}

module.exports = {
  DEFAULT_SECRET_LEASE_TTL_MS,
  MAX_SECRET_LEASES_PER_RUNTIME,
  MAX_SECRET_LEASE_TTL_MS,
  SecretLeaseStore,
  assertLeaseReference,
};
