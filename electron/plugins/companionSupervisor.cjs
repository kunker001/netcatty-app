"use strict";

const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFile: nodeExecFile, spawn: nodeSpawn } = require("node:child_process");

const { isPathInside } = require("./paths.cjs");
const { canonicalizeCompanionResource } = require("./permissionResources.cjs");
const { PluginRpcError, RPC_ERRORS } = require("./rpcRouter.cjs");

const MAX_COMPANIONS_PER_RUNTIME = 4;
const MAX_COMPANION_PENDING = 64;
const MAX_COMPANION_STDERR_BYTES = 64 * 1024;
const COMPANION_TERMINATION_GRACE_MS = 500;
const COMPANION_CONTAINMENT_TIMEOUT_MS = 2_000;
const PROCESS_TREE_POLL_MS = 25;

function platformKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

function assertCompanionId(value) {
  try {
    return canonicalizeCompanionResource(value);
  } catch {
    throw new PluginRpcError(RPC_ERRORS.invalidArgument, "Plugin companion ID is invalid");
  }
}

function assertHandleId(value) {
  if (typeof value !== "string" || value.length < 16 || value.length > 128) {
    throw new PluginRpcError(RPC_ERRORS.invalidArgument, "Plugin companion handle is invalid");
  }
  return value;
}

function assertOperationId(value) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 128
    || value.includes("\0")
  ) {
    throw new PluginRpcError(RPC_ERRORS.invalidArgument, "Plugin companion operation ID is invalid");
  }
  return value;
}

function assertCompanionMethod(value) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 256
    || value.startsWith("$/")
    || !/^[A-Za-z][A-Za-z0-9_.-]*$/u.test(value)
  ) throw new PluginRpcError(RPC_ERRORS.invalidArgument, "Plugin companion RPC method is invalid");
  return value;
}

function assertAdvancedCompanionContext(context) {
  if (context?.runtimeKind !== "utility" || typeof context.manifest?.main?.node !== "string") {
    throw new PluginRpcError(
      RPC_ERRORS.permissionDenied,
      "Plugin companions require an advanced utility runtime",
      { pluginCode: "permission_denied" },
    );
  }
}

function rpcIdKey(id) {
  return `${typeof id}:${String(id)}`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntilStopped(isAlive, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (isAlive()) {
    if (Date.now() >= deadline) return false;
    await delay(Math.min(PROCESS_TREE_POLL_MS, Math.max(1, deadline - Date.now())));
  }
  return true;
}

function isPosixProcessGroupAlive(pid, kill = process.kill) {
  try {
    kill(-pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

function signalPosixProcessGroup(pid, signal, kill = process.kill) {
  try {
    kill(-pid, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function runTaskkill(pid, force, execFile = nodeExecFile) {
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  const executable = path.join(systemRoot, "System32", "taskkill.exe");
  const args = ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])];
  return new Promise((resolve) => {
    execFile(executable, args, {
      windowsHide: true,
      timeout: force ? COMPANION_CONTAINMENT_TIMEOUT_MS : COMPANION_TERMINATION_GRACE_MS,
    }, (error) => resolve(error == null));
  });
}

async function terminateDirectChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try { child.kill(); } catch {}
  if (await waitUntilStopped(
    () => child.exitCode === null && child.signalCode === null,
    COMPANION_TERMINATION_GRACE_MS,
  )) return;
  try { child.kill("SIGKILL"); } catch {}
  if (await waitUntilStopped(
    () => child.exitCode === null && child.signalCode === null,
    COMPANION_CONTAINMENT_TIMEOUT_MS - COMPANION_TERMINATION_GRACE_MS,
  )) return;
  throw new Error("Plugin companion direct process did not exit");
}

async function terminateCompanionProcessTree(child, options = {}) {
  const platform = options.platform ?? process.platform;
  const pid = child?.pid;
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    await terminateDirectChild(child);
    return;
  }
  if (platform === "win32") {
    const graceful = await runTaskkill(pid, false, options.execFile);
    await (options.delay ?? delay)(COMPANION_TERMINATION_GRACE_MS);
    const forced = await runTaskkill(pid, true, options.execFile);
    if (!graceful && !forced && child.exitCode === null && child.signalCode === null) {
      throw new Error("Plugin companion process tree could not be terminated");
    }
    return;
  }
  const kill = options.kill ?? process.kill;
  signalPosixProcessGroup(pid, "SIGTERM", kill);
  if (await waitUntilStopped(
    () => isPosixProcessGroupAlive(pid, kill),
    COMPANION_TERMINATION_GRACE_MS,
  )) return;
  signalPosixProcessGroup(pid, "SIGKILL", kill);
  if (await waitUntilStopped(
    () => isPosixProcessGroupAlive(pid, kill),
    COMPANION_CONTAINMENT_TIMEOUT_MS - COMPANION_TERMINATION_GRACE_MS,
  )) return;
  throw new Error("Plugin companion process group could not be reaped");
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  const input = fs.createReadStream(filePath);
  for await (const chunk of input) hash.update(chunk);
  return hash.digest("hex");
}

async function resolveCompanionVariant(identity, companionId, targetPlatform = platformKey()) {
  const companion = identity.manifest.companionExecutables?.find(({ id }) => id === companionId);
  if (!companion) throw new PluginRpcError(RPC_ERRORS.notFound, "Plugin companion is not declared");
  const variant = companion.variants.find(({ platforms }) => platforms.includes(targetPlatform));
  if (!variant) throw new PluginRpcError(RPC_ERRORS.unsupported, "Plugin companion has no compatible binary");
  const candidate = path.resolve(identity.packageRoot, ...variant.path.split("/"));
  const [realRoot, realCandidate] = await Promise.all([
    fsp.realpath(identity.packageRoot),
    fsp.realpath(candidate),
  ]);
  if (!isPathInside(realRoot, realCandidate)) {
    throw new PluginRpcError(RPC_ERRORS.permissionDenied, "Plugin companion escapes its package");
  }
  const stats = await fsp.lstat(realCandidate);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new PluginRpcError(RPC_ERRORS.failedPrecondition, "Plugin companion is not a regular file");
  }
  const digest = await sha256File(realCandidate);
  if (digest !== variant.sha256) {
    throw new PluginRpcError(RPC_ERRORS.dataLoss, "Plugin companion digest mismatch");
  }
  return { companion, variant, executablePath: realCandidate };
}

class CompanionRpcPeer {
  constructor(options) {
    this.child = options.child;
    this.contract = options.contract;
    this.onProtocolError = options.onProtocolError;
    this.pending = new Map();
    this.retiredResponseIds = new Set();
    this.nextId = 0;
    this.closed = false;
    this.decoder = new this.contract.ContentLengthFrameDecoder();
    this.child.stdout.on("data", (chunk) => this.#acceptBytes(chunk));
    this.child.stdout.on("end", () => {
      try { this.decoder.finish(); }
      catch (error) { this.#fail(error); }
    });
  }

  #send(value) {
    if (this.closed || !this.child.stdin.writable) {
      throw new PluginRpcError(RPC_ERRORS.unavailable, "Plugin companion is closed");
    }
    const frame = this.contract.encodeContentLengthFrame(value);
    this.child.stdin.write(frame);
  }

  #acceptBytes(chunk) {
    if (this.closed) return;
    try {
      for (const message of this.decoder.push(chunk)) this.#accept(message);
    } catch (error) {
      this.#fail(error);
    }
  }

  #accept(message) {
    if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0") {
      throw new Error("Plugin companion returned a non-RPC message");
    }
    if (Object.hasOwn(message, "id") && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) {
      if (Object.hasOwn(message, "result") === Object.hasOwn(message, "error")) {
        throw new Error("Plugin companion response must contain exactly one result or error");
      }
      const key = rpcIdKey(message.id);
      const pending = this.pending.get(key);
      if (!pending) {
        if (this.retiredResponseIds.delete(key)) return;
        throw new Error("Plugin companion returned an unknown response ID");
      }
      this.pending.delete(key);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new PluginRpcError(
          Number.isInteger(message.error.code) ? message.error.code : RPC_ERRORS.internal,
          typeof message.error.message === "string" ? message.error.message.slice(0, 2_048) : "Companion request failed",
          message.error.data,
        ));
      } else pending.resolve(message.result ?? null);
      return;
    }
    if (Object.hasOwn(message, "id")) {
      this.#send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "Companion-to-host methods are not exposed" },
      });
    }
  }

  #allocateRequestId() {
    for (
      let attempt = 0;
      attempt <= this.pending.size + this.retiredResponseIds.size;
      attempt += 1
    ) {
      const id = this.nextId;
      this.nextId = this.nextId === Number.MAX_SAFE_INTEGER ? 0 : this.nextId + 1;
      const key = rpcIdKey(id);
      if (!this.pending.has(key) && !this.retiredResponseIds.has(key)) return id;
    }
    throw new PluginRpcError(RPC_ERRORS.resourceExhausted, "No companion RPC correlation ID is available");
  }

  #retireResponseId(key) {
    this.retiredResponseIds.add(key);
    while (this.retiredResponseIds.size > MAX_COMPANION_PENDING) {
      this.retiredResponseIds.delete(this.retiredResponseIds.values().next().value);
    }
  }

  request(method, params, timeoutMs) {
    if (this.closed) return Promise.reject(new PluginRpcError(RPC_ERRORS.unavailable, "Plugin companion is closed"));
    if (this.pending.size >= MAX_COMPANION_PENDING) {
      return Promise.reject(new PluginRpcError(RPC_ERRORS.resourceExhausted, "Too many companion requests"));
    }
    const id = this.#allocateRequestId();
    const key = rpcIdKey(id);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        this.#retireResponseId(key);
        reject(new PluginRpcError(RPC_ERRORS.deadlineExceeded, `Companion request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(key, { resolve, reject, timer });
      try {
        this.#send({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
      } catch (error) {
        this.pending.delete(key);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  #fail(error) {
    if (this.closed) return;
    this.close(error);
    this.onProtocolError(error);
  }

  close(error = new PluginRpcError(RPC_ERRORS.unavailable, "Plugin companion closed")) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.retiredResponseIds.clear();
    try { this.child.stdin.end(); } catch {}
  }
}

class PluginCompanionSupervisor {
  constructor(options) {
    this.paths = options.paths;
    this.spawn = options.spawn ?? nodeSpawn;
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.quotaManager = options.quotaManager ?? null;
    this.onContainmentFailure = options.onContainmentFailure ?? (() => {});
    this.terminateProcessTree = options.terminateProcessTree
      ?? ((child) => terminateCompanionProcessTree(child, { platform: this.platform }));
    this.handles = new Map();
    this.startingCounts = new Map();
    this.contractPromise = null;
    this.closed = false;
  }

  #loadContract() {
    this.contractPromise ??= import("@netcatty/plugin-contract");
    return this.contractPromise;
  }

  validateStart(params) {
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      throw new PluginRpcError(RPC_ERRORS.invalidArgument, "Plugin companion start parameters are invalid");
    }
    return { companionId: assertCompanionId(params.companionId) };
  }

  validateRequest(params) {
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      throw new PluginRpcError(RPC_ERRORS.invalidArgument, "Plugin companion request parameters are invalid");
    }
    const timeoutMs = params.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
      throw new PluginRpcError(RPC_ERRORS.invalidArgument, "Plugin companion request timeout is invalid");
    }
    let credentialLeases;
    let operationId;
    if (params.credentialLeases !== undefined) {
      if (!params.credentialLeases || typeof params.credentialLeases !== "object"
        || Array.isArray(params.credentialLeases)
        || Object.keys(params.credentialLeases).length < 1
        || Object.keys(params.credentialLeases).length > 16) {
        throw new PluginRpcError(RPC_ERRORS.invalidArgument, "Plugin companion credential leases are invalid");
      }
      operationId = assertOperationId(params.operationId);
      credentialLeases = {};
      for (const [name, lease] of Object.entries(params.credentialLeases)) {
        if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(name)
          || !lease || typeof lease !== "object" || Array.isArray(lease)
          || lease.kind !== "secret-lease"
          || typeof lease.id !== "string" || lease.id.length < 16 || lease.id.length > 256) {
          throw new PluginRpcError(RPC_ERRORS.invalidArgument, "Plugin companion credential lease is invalid");
        }
        credentialLeases[name] = Object.freeze({ kind: "secret-lease", id: lease.id });
      }
      Object.freeze(credentialLeases);
    }
    return {
      handleId: assertHandleId(params.handleId),
      method: assertCompanionMethod(params.method),
      ...(params.params === undefined ? {} : { params: params.params }),
      ...(credentialLeases === undefined ? {} : { credentialLeases, operationId }),
      timeoutMs,
    };
  }

  validateStop(params) {
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      throw new PluginRpcError(RPC_ERRORS.invalidArgument, "Plugin companion stop parameters are invalid");
    }
    return { handleId: assertHandleId(params.handleId) };
  }

  describeStartAuthorization(params, context) {
    assertAdvancedCompanionContext(context);
    const value = this.validateStart(params);
    return {
      permission: "companion.execute",
      resources: [value.companionId],
      reason: `Launch companion ${value.companionId}`,
      operationId: `companion.start:${value.companionId}`,
    };
  }

  describeHandleAuthorization(params, context) {
    const handleId = assertHandleId(params?.handleId);
    const record = this.#ownedRecord(handleId, context);
    return {
      permission: "companion.execute",
      resources: [record.companionId],
      reason: `Use companion ${record.companionId}`,
      operationId: `companion:${handleId}`,
    };
  }

  #reserveStart(runtimeId) {
    const activeCount = [...this.handles.values()].filter((record) => (
      record.runtimeId === runtimeId
    )).length;
    const startingCount = this.startingCounts.get(runtimeId) ?? 0;
    if (activeCount + startingCount >= MAX_COMPANIONS_PER_RUNTIME) {
      throw new PluginRpcError(RPC_ERRORS.resourceExhausted, "Plugin companion process quota exceeded");
    }
    this.startingCounts.set(runtimeId, startingCount + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.startingCounts.get(runtimeId) ?? 1) - 1;
      if (remaining <= 0) this.startingCounts.delete(runtimeId);
      else this.startingCounts.set(runtimeId, remaining);
    };
  }

  async start(params, context) {
    if (this.closed) throw new PluginRpcError(RPC_ERRORS.unavailable, "Plugin companion supervisor is closed");
    assertAdvancedCompanionContext(context);
    const { companionId } = this.validateStart(params);
    const releaseReservation = this.#reserveStart(context.runtimeId);
    return this.#startReserved(companionId, context).finally(releaseReservation);
  }

  async #startReserved(companionId, context) {
    const dataDirectory = path.join(this.paths.data, context.pluginId);
    await fsp.mkdir(dataDirectory, { recursive: true, mode: 0o700 });
    const contract = await this.#loadContract();
    await context.assertActive();
    const resolved = await resolveCompanionVariant(
      context,
      companionId,
      platformKey(this.platform, this.arch),
    );
    context.signal?.throwIfAborted();
    const child = this.spawn(resolved.executablePath, [], {
      cwd: dataDirectory,
      env: {
        LANG: process.env.LANG ?? "C.UTF-8",
        LC_ALL: process.env.LC_ALL ?? "",
      },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: this.platform !== "win32",
    });
    const handleId = randomUUID();
    const record = {
      handleId,
      companionId,
      pluginId: context.pluginId,
      pluginVersion: context.pluginVersion,
      runtimeId: context.runtimeId,
      runtimeKind: context.runtimeKind,
      securityPrincipal: context.securityPrincipal,
      child,
      peer: null,
      quotaResourceId: `${context.runtimeId}\0companion:${handleId}`,
      stopping: false,
      stderrBytes: 0,
    };
    const peer = new CompanionRpcPeer({
      child,
      contract,
      onProtocolError: () => { void this.#stopRecord(record); },
    });
    record.peer = peer;
    this.handles.set(handleId, record);
    child.stderr.on("data", (chunk) => {
      record.stderrBytes += chunk.byteLength;
      if (record.stderrBytes > MAX_COMPANION_STDERR_BYTES) void this.#stopRecord(record);
    });
    child.once("exit", () => {
      peer.close();
      if (!record.stopping) void this.#stopRecord(record).catch(() => {});
    });
    try {
      await new Promise((resolve, reject) => {
        const onSpawn = () => {
          child.removeListener("error", onError);
          resolve();
        };
        const onError = (error) => {
          child.removeListener("spawn", onSpawn);
          reject(error);
        };
        child.once("spawn", onSpawn);
        child.once("error", onError);
      });
    } catch (error) {
      peer.close();
      this.handles.delete(handleId);
      throw new PluginRpcError(
        RPC_ERRORS.unavailable,
        `Plugin companion failed to start: ${error?.message ?? String(error)}`,
      );
    }
    this.quotaManager?.trackProcess?.(
      record.quotaResourceId,
      Object.freeze({
        pluginId: record.pluginId,
        pluginVersion: record.pluginVersion,
        runtimeId: record.runtimeId,
        runtimeKind: record.runtimeKind,
        securityPrincipal: record.securityPrincipal,
      }),
      { getProcessId: () => child.pid },
    );
    child.once("error", () => { void this.#stopRecord(record); });
    try {
      await context.assertActive();
    } catch (error) {
      await this.#stopRecord(record);
      throw error;
    }
    return { handleId };
  }

  #ownedRecord(handleId, context) {
    const record = this.handles.get(handleId);
    if (!record || record.pluginId !== context.pluginId || record.runtimeId !== context.runtimeId) {
      throw new PluginRpcError(RPC_ERRORS.notFound, "Plugin companion handle was not found");
    }
    return record;
  }

  async request(params, context) {
    const value = this.validateRequest(params);
    const record = this.#ownedRecord(value.handleId, context);
    this.quotaManager?.chargeBytes(
      context.runtimeId,
      "companion",
      Buffer.byteLength(JSON.stringify(value.params ?? null)),
    );
    const result = await record.peer.request(value.method, value.params, value.timeoutMs);
    this.quotaManager?.chargeBytes(context.runtimeId, "companion", Buffer.byteLength(JSON.stringify(result)));
    await context.assertActive();
    return result;
  }

  async stop(params, context) {
    const value = this.validateStop(params);
    await this.#stopRecord(this.#ownedRecord(value.handleId, context));
    return null;
  }

  async #stopRecord(record) {
    if (record.stopping) return record.stopPromise;
    record.stopping = true;
    record.stopPromise = Promise.resolve().then(() => this.terminateProcessTree(record.child)).then(() => {
      record.peer.close();
      this.quotaManager?.releaseProcess?.(record.quotaResourceId);
      this.handles.delete(record.handleId);
    }, async (error) => {
      const containmentError = new PluginRpcError(
        RPC_ERRORS.failedPrecondition,
        `Plugin companion could not be reaped: ${record.companionId}`,
        { cause: error?.message ?? String(error) },
      );
      record.peer.close(containmentError);
      record.stopping = false;
      record.stopPromise = null;
      await this.onContainmentFailure(Object.freeze({
        pluginId: record.pluginId,
        pluginVersion: record.pluginVersion,
        runtimeId: record.runtimeId,
        runtimeKind: record.runtimeKind,
        securityPrincipal: record.securityPrincipal,
      }), containmentError);
      throw containmentError;
    });
    return record.stopPromise;
  }

  async releaseRuntime(runtimeId) {
    const results = await Promise.allSettled([...this.handles.values()]
      .filter((record) => record.runtimeId === runtimeId)
      .map((record) => this.#stopRecord(record)));
    const failures = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, `Plugin companion cleanup failed for runtime: ${runtimeId}`);
    }
  }

  async shutdown() {
    this.closed = true;
    await Promise.allSettled([...this.handles.values()].map((record) => this.#stopRecord(record)));
    this.startingCounts.clear();
  }
}

module.exports = {
  COMPANION_CONTAINMENT_TIMEOUT_MS,
  COMPANION_TERMINATION_GRACE_MS,
  CompanionRpcPeer,
  MAX_COMPANIONS_PER_RUNTIME,
  MAX_COMPANION_PENDING,
  PluginCompanionSupervisor,
  assertCompanionId,
  assertCompanionMethod,
  platformKey,
  resolveCompanionVariant,
  rpcIdKey,
  isPosixProcessGroupAlive,
  signalPosixProcessGroup,
  sha256File,
  terminateCompanionProcessTree,
};
