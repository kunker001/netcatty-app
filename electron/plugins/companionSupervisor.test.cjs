"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const test = require("node:test");

const {
  CompanionRpcPeer,
  PluginCompanionSupervisor,
  terminateCompanionProcessTree,
} = require("./companionSupervisor.cjs");
const { RPC_ERRORS } = require("./rpcRouter.cjs");

function createRoot(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-plugin-companion-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function runtimeContext(packageRoot, digest, overrides = {}) {
  return {
    pluginId: "com.example.companion",
    pluginVersion: "1.0.0",
    runtimeId: "runtime-1",
    runtimeKind: "utility",
    securityPrincipal: "unsigned-package:test",
    packageRoot,
    manifest: {
      main: { node: "dist/node.js" },
      permissions: {
        required: [
          "runtime.advanced",
          {
            permission: "companion.execute",
            resources: ["com.example.companion.helper"],
          },
        ],
      },
      companionExecutables: [{
        id: "com.example.companion.helper",
        variants: [{ path: "bin/helper", platforms: [`${process.platform}-${process.arch}`], sha256: digest }],
      }],
    },
    assertActive: async () => {},
    ...overrides,
  };
}

test("companion requests accept only the public secret-lease reference shape", () => {
  const supervisor = new PluginCompanionSupervisor({
    paths: { data: path.join(os.tmpdir(), "netcatty-plugin-companion-validation") },
  });
  const params = {
    handleId: "companion-handle-0001",
    method: "authenticate",
    credentialLeases: {
      password: { kind: "secret-lease", id: "credential-lease-password" },
    },
    operationId: "login",
  };

  assert.deepEqual(supervisor.validateRequest(params), {
    ...params,
    timeoutMs: 30_000,
  });
  assert.throws(
    () => supervisor.validateRequest({
      ...params,
      credentialLeases: {
        password: { kind: "secretLease", id: "credential-lease-password" },
      },
    }),
    (error) => error.code === RPC_ERRORS.invalidArgument,
  );
});

test("ordinary browser runtimes cannot authorize or launch native companions", async (context) => {
  const root = createRoot(context);
  let spawnCalls = 0;
  const supervisor = new PluginCompanionSupervisor({
    paths: { data: path.join(root, "data") },
    spawn: () => {
      spawnCalls += 1;
      throw new Error("browser companion must never spawn");
    },
  });
  const browser = runtimeContext(root, "0".repeat(64), {
    runtimeKind: "browser",
    manifest: {
      main: { browser: "dist/browser.js" },
      permissions: {
        required: [{
          permission: "companion.execute",
          resources: ["com.example.companion.helper"],
        }],
      },
      companionExecutables: [{
        id: "com.example.companion.helper",
        variants: [{
          path: "bin/helper",
          platforms: [`${process.platform}-${process.arch}`],
          sha256: "0".repeat(64),
        }],
      }],
    },
  });
  assert.throws(
    () => supervisor.describeStartAuthorization({
      companionId: "com.example.companion.helper",
    }, browser),
    (error) => error.code === RPC_ERRORS.permissionDenied,
  );
  await assert.rejects(
    supervisor.start({ companionId: "com.example.companion.helper" }, browser),
    (error) => error.code === RPC_ERRORS.permissionDenied,
  );
  assert.equal(spawnCalls, 0);
  await supervisor.shutdown();
});

class FakeChild extends EventEmitter {
  constructor(contract, responseId = (id) => id) {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
    this.signalCode = null;
    const decoder = new contract.ContentLengthFrameDecoder();
    this.stdin.on("data", (chunk) => {
      for (const message of decoder.push(chunk)) {
        if (!Object.hasOwn(message, "id")) continue;
        queueMicrotask(() => this.stdout.write(contract.encodeContentLengthFrame({
          jsonrpc: "2.0",
          id: responseId(message.id),
          result: { echoed: message.params ?? null },
        })));
      }
    });
    queueMicrotask(() => this.emit("spawn"));
  }

  kill(signal = "SIGTERM") {
    this.signalCode = signal;
    queueMicrotask(() => this.emit("exit", null, signal));
    return true;
  }
}

class ManualChild extends EventEmitter {
  constructor(contract) {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
    this.signalCode = null;
    this.messages = [];
    const decoder = new contract.ContentLengthFrameDecoder();
    this.stdin.on("data", (chunk) => this.messages.push(...decoder.push(chunk)));
  }

  respond(contract, id, result) {
    this.stdout.write(contract.encodeContentLengthFrame({ jsonrpc: "2.0", id, result }));
  }
}

test("companion RPC correlation keeps numeric and string IDs distinct", async () => {
  const contract = await import("@netcatty/plugin-contract");
  const child = new FakeChild(contract, (id) => String(id));
  const errors = [];
  const peer = new CompanionRpcPeer({
    child,
    contract,
    onProtocolError: (error) => errors.push(error.message),
  });
  await assert.rejects(peer.request("echo", null, 1_000), /unknown response ID/);
  assert.deepEqual(errors, ["Plugin companion returned an unknown response ID"]);
});

test("companion RPC ignores one late timed-out response and never reuses its ID", async () => {
  const contract = await import("@netcatty/plugin-contract");
  const child = new ManualChild(contract);
  const errors = [];
  const peer = new CompanionRpcPeer({
    child,
    contract,
    onProtocolError: (error) => errors.push(error.message),
  });
  await assert.rejects(
    peer.request("slow", null, 5),
    (error) => error.code === RPC_ERRORS.deadlineExceeded,
  );
  assert.equal(child.messages[0].id, 0);
  peer.nextId = 0;
  const next = peer.request("next", { value: 1 }, 1_000);
  assert.equal(child.messages[1].id, 1);
  child.respond(contract, 0, { late: true });
  child.respond(contract, 1, { ok: true });
  assert.deepEqual(await next, { ok: true });
  assert.deepEqual(errors, []);
  peer.close();
});

test("companion launch verifies digest immediately and never spawns a mismatch", async (context) => {
  const root = createRoot(context);
  const packageRoot = path.join(root, "package");
  const executable = path.join(packageRoot, "bin/helper");
  await fsp.mkdir(path.dirname(executable), { recursive: true });
  await fsp.writeFile(executable, "binary");
  let spawnCalls = 0;
  const supervisor = new PluginCompanionSupervisor({
    paths: { data: path.join(root, "data") },
    spawn: () => { spawnCalls += 1; throw new Error("must not spawn"); },
  });
  await assert.rejects(
    supervisor.start(
      { companionId: "com.example.companion.helper" },
      runtimeContext(packageRoot, "0".repeat(64)),
    ),
    (error) => error.code === RPC_ERRORS.dataLoss,
  );
  assert.equal(spawnCalls, 0);
  await supervisor.shutdown();
});

test("companion runs shell-free with sanitized environment and bounded host-only RPC", async (context) => {
  const root = createRoot(context);
  const packageRoot = path.join(root, "package");
  const executable = path.join(packageRoot, "bin/helper");
  await fsp.mkdir(path.dirname(executable), { recursive: true });
  const contents = Buffer.from("binary");
  await fsp.writeFile(executable, contents);
  const digest = createHash("sha256").update(contents).digest("hex");
  const contract = await import("@netcatty/plugin-contract");
  const spawns = [];
  const tracked = [];
  const supervisor = new PluginCompanionSupervisor({
    paths: { data: path.join(root, "data") },
    spawn: (command, args, options) => {
      const child = new FakeChild(contract);
      spawns.push({ command, args, options, child });
      return child;
    },
    quotaManager: {
      trackProcess: (resourceId, identity) => tracked.push({ resourceId, identity }),
      releaseProcess() {},
      chargeBytes() {},
    },
  });
  const runtime = runtimeContext(packageRoot, digest);
  const handle = await supervisor.start({ companionId: "com.example.companion.helper" }, runtime);
  assert.equal(spawns[0].command, await fsp.realpath(executable));
  assert.deepEqual(spawns[0].args, []);
  assert.equal(spawns[0].options.shell, false);
  assert.equal(spawns[0].options.detached, process.platform !== "win32");
  assert.deepEqual(Object.keys(spawns[0].options.env).sort(), ["LANG", "LC_ALL"]);
  assert.deepEqual(tracked, [{
    resourceId: `${runtime.runtimeId}\0companion:${handle.handleId}`,
    identity: {
      pluginId: runtime.pluginId,
      pluginVersion: runtime.pluginVersion,
      runtimeId: runtime.runtimeId,
      runtimeKind: runtime.runtimeKind,
      securityPrincipal: runtime.securityPrincipal,
    },
  }]);

  assert.deepEqual(await supervisor.request({
    handleId: handle.handleId,
    method: "echo",
    params: { value: 1 },
  }, runtime), { echoed: { value: 1 } });
  await assert.rejects(
    supervisor.request({ handleId: handle.handleId, method: "echo" }, {
      ...runtime,
      runtimeId: "runtime-2",
    }),
    (error) => error.code === RPC_ERRORS.notFound,
  );
  await supervisor.stop({ handleId: handle.handleId }, runtime);
  assert.equal(spawns[0].child.signalCode, "SIGTERM");
  await supervisor.shutdown();
});

test("companion cleanup reports the complete runtime identity and rejects containment failure", async (context) => {
  const root = createRoot(context);
  const packageRoot = path.join(root, "package");
  const executable = path.join(packageRoot, "bin/helper");
  await fsp.mkdir(path.dirname(executable), { recursive: true });
  const contents = Buffer.from("binary");
  await fsp.writeFile(executable, contents);
  const digest = createHash("sha256").update(contents).digest("hex");
  const contract = await import("@netcatty/plugin-contract");
  const failures = [];
  const supervisor = new PluginCompanionSupervisor({
    paths: { data: path.join(root, "data") },
    spawn: () => new FakeChild(contract),
    terminateProcessTree: async () => { throw new Error("process tree survived"); },
    onContainmentFailure: (identity, error) => failures.push({ identity, error }),
  });
  const runtime = runtimeContext(packageRoot, digest);
  await supervisor.start({ companionId: "com.example.companion.helper" }, runtime);

  await assert.rejects(
    supervisor.releaseRuntime(runtime.runtimeId),
    (error) => error.code === RPC_ERRORS.failedPrecondition,
  );
  assert.deepEqual(failures.map(({ identity }) => identity), [{
    pluginId: runtime.pluginId,
    pluginVersion: runtime.pluginVersion,
    runtimeId: runtime.runtimeId,
    runtimeKind: runtime.runtimeKind,
    securityPrincipal: runtime.securityPrincipal,
  }]);
  assert.match(failures[0].error.message, /could not be reaped/);
  await supervisor.shutdown();
});

test("Windows companion termination uses shell-free tree cleanup for both stages", async () => {
  const calls = [];
  await terminateCompanionProcessTree({
    pid: 1234,
    exitCode: null,
    signalCode: null,
  }, {
    platform: "win32",
    delay: async () => {},
    execFile(executable, args, options, callback) {
      calls.push({ executable, args, options });
      callback(null);
    },
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, ["/PID", "1234", "/T"]);
  assert.deepEqual(calls[1].args, ["/PID", "1234", "/T", "/F"]);
  assert.equal(calls[0].options.windowsHide, true);
});

test("companion stop reaps its POSIX descendant process group", {
  skip: process.platform === "win32" || /\s/u.test(process.execPath),
}, async (context) => {
  const root = createRoot(context);
  const packageRoot = path.join(root, "package");
  const executable = path.join(packageRoot, "bin/helper");
  const dataDirectory = path.join(root, "data", "com.example.companion");
  const pidFile = path.join(dataDirectory, "descendant.pid");
  await fsp.mkdir(path.dirname(executable), { recursive: true });
  const contents = Buffer.from(`#!${process.execPath}\n`
    + `const fs = require("node:fs");\n`
    + `const { spawn } = require("node:child_process");\n`
    + `process.on("SIGTERM", () => {});\n`
    + `const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: "ignore" });\n`
    + `fs.writeFileSync("descendant.pid", String(child.pid));\n`
    + `setInterval(() => {}, 1000);\n`);
  await fsp.writeFile(executable, contents, { mode: 0o755 });
  await fsp.chmod(executable, 0o755);
  const digest = createHash("sha256").update(contents).digest("hex");
  const supervisor = new PluginCompanionSupervisor({ paths: { data: path.join(root, "data") } });
  const runtime = runtimeContext(packageRoot, digest);
  const handle = await supervisor.start({ companionId: "com.example.companion.helper" }, runtime);
  let descendantPid;
  // The complete plugin suite runs many test files in parallel, so process
  // scheduling can exceed one second on a busy CI host. Treat the PID file as
  // the explicit readiness barrier and keep a bounded ten-second deadline.
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    try {
      descendantPid = Number(await fsp.readFile(pidFile, "utf8"));
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0);
  context.after(() => {
    if (!descendantPid) return;
    try { process.kill(descendantPid, "SIGKILL"); } catch {}
  });
  await supervisor.stop({ handleId: handle.handleId }, runtime);
  await assert.rejects(
    Promise.resolve().then(() => process.kill(descendantPid, 0)),
    (error) => error?.code === "ESRCH",
  );
  await supervisor.shutdown();
});

test("concurrent companion starts reserve the per-runtime process quota", async (context) => {
  const root = createRoot(context);
  const packageRoot = path.join(root, "package");
  const executable = path.join(packageRoot, "bin/helper");
  await fsp.mkdir(path.dirname(executable), { recursive: true });
  const contents = Buffer.from("binary");
  await fsp.writeFile(executable, contents);
  const digest = createHash("sha256").update(contents).digest("hex");
  const contract = await import("@netcatty/plugin-contract");
  let spawns = 0;
  const supervisor = new PluginCompanionSupervisor({
    paths: { data: path.join(root, "data") },
    spawn: () => {
      spawns += 1;
      return new FakeChild(contract);
    },
  });
  const runtime = runtimeContext(packageRoot, digest);
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => (
    supervisor.start({ companionId: "com.example.companion.helper" }, runtime)
  )));
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 4);
  assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
  assert.equal(results.find(({ status }) => status === "rejected").reason.code, RPC_ERRORS.resourceExhausted);
  assert.equal(spawns, 4);
  await supervisor.shutdown();
});
