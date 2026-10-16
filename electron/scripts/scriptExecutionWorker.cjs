"use strict";

const vm = require("node:vm");
const { parentPort } = require("node:worker_threads");

if (!parentPort) {
  throw new Error("Script execution worker requires a parent port");
}

const pendingRequests = new Map();
let nextRequestId = 1;
let finished = false;
let started = false;
let heartbeat = null;
let heartbeatTimer = null;
let runtimeSnapshot = null;
let nct = null;
let maxPendingHostRequests = 128;
let maxLogNotifications = 512;
let maxTotalNotifications = 20_000;
let logNotificationCount = 0;
let totalNotificationCount = 0;

function beat() {
  if (heartbeat) Atomics.store(heartbeat, 0, BigInt(Date.now()));
}

function serializeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    stack: typeof error?.stack === "string" ? error.stack : undefined,
  };
}

function reviveError(value) {
  const error = new Error(value?.message || "Script API request failed");
  error.name = value?.name || "Error";
  if (typeof value?.stack === "string") error.stack = value.stack;
  return error;
}

function updateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return;
  if (snapshot.session && typeof snapshot.session === "object") {
    Object.assign(runtimeSnapshot.session, snapshot.session);
  }
  if (snapshot.screen && typeof snapshot.screen === "object") {
    Object.assign(runtimeSnapshot.screen, snapshot.screen);
  }
}

function callHost(method, args = []) {
  if (finished) return Promise.reject(new Error("Script execution finished"));
  if (pendingRequests.size >= maxPendingHostRequests) {
    throw new Error(
      `Script exceeded the ${maxPendingHostRequests} pending host request limit`,
    );
  }
  const requestId = nextRequestId++;
  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });
    parentPort.postMessage({ type: "rpc", requestId, method, args });
  });
}

function notifyHost(method, args = []) {
  if (finished) return;
  totalNotificationCount += 1;
  if (totalNotificationCount > maxTotalNotifications) {
    throw new Error(`Script exceeded the ${maxTotalNotifications} notification limit`);
  }
  if (method === "log" || method === "console.log") {
    logNotificationCount += 1;
    if (logNotificationCount > maxLogNotifications) {
      throw new Error(`Script exceeded the ${maxLogNotifications} log notification limit`);
    }
  }
  parentPort.postMessage({ type: "notify", method, args });
}

const sessionApi = {
  get connected() { return runtimeSnapshot.session.connected; },
  get name() { return runtimeSnapshot.session.name; },
  get hostname() { return runtimeSnapshot.session.hostname; },
  get username() { return runtimeSnapshot.session.username; },
  sleep: (ms) => callHost("session.sleep", [ms]),
  startLog: (path) => callHost("session.startLog", [path == null ? path : String(path)]),
  stopLog: () => callHost("session.stopLog"),
  disconnect: () => callHost("session.disconnect"),
};

const screenApi = {
  send: (text, options) => callHost("screen.send", [
    String(text ?? ""),
    { sensitive: options?.sensitive === true },
  ]),
  sendLine: (text, options) => callHost("screen.sendLine", [
    String(text ?? ""),
    { sensitive: options?.sensitive === true },
  ]),
  waitFor: (pattern, timeoutMs) => callHost("screen.waitFor", [pattern, timeoutMs]),
  waitForText: (text, timeoutMs) => callHost("screen.waitForText", [text, timeoutMs]),
  waitForRegex: (pattern, timeoutMs) => callHost("screen.waitForRegex", [pattern, timeoutMs]),
  waitForPrompt: (timeoutMs) => callHost("screen.waitForPrompt", [timeoutMs]),
  waitForAny: (patterns, timeoutMs) => callHost("screen.waitForAny", [patterns, timeoutMs]),
  getText: (startRow, endRow) => callHost("screen.getText", [startRow, endRow]),
  get currentRow() { return runtimeSnapshot.screen.currentRow; },
  get rows() { return runtimeSnapshot.screen.rows; },
  get cols() { return runtimeSnapshot.screen.cols; },
  clear: () => callHost("screen.clear"),
};

const dialogApi = {
  alert: (message) => callHost("dialog.alert", [String(message ?? "")]),
  confirm: (message) => callHost("dialog.confirm", [String(message ?? "")]),
  prompt: (message, defaultValue, options) => callHost("dialog.prompt", [
    String(message ?? ""),
    String(defaultValue ?? ""),
    { sensitive: options?.sensitive === true },
  ]),
  form: (spec) => callHost("dialog.form", [spec]),
  select: (message, options, defaultValue) => callHost("dialog.select", [message, options, defaultValue]),
  radio: (message, options, defaultValue) => callHost("dialog.radio", [message, options, defaultValue]),
  checkbox: (message, defaultChecked) => callHost("dialog.checkbox", [message, defaultChecked]),
};

const progressApi = {
  start(label, total) { notifyHost("progress.start", [label, total]); },
  set(current, detail) { notifyHost("progress.set", [current, detail]); },
  step(detail) { notifyHost("progress.step", [detail]); },
  done() { notifyHost("progress.done"); },
};

parentPort.on("message", (message) => {
  if (message?.type === "start") {
    if (started) return;
    started = true;
    void run(message.config);
    return;
  }
  if (message?.type === "snapshot") {
    updateSnapshot(message.snapshot);
    return;
  }
  if (message?.type !== "rpc-result") return;
  const pending = pendingRequests.get(message.requestId);
  if (!pending) return;
  pendingRequests.delete(message.requestId);
  updateSnapshot(message.snapshot);
  if (message.ok) pending.resolve(message.value);
  else pending.reject(reviveError(message.error));
});

async function run(config) {
  maxPendingHostRequests = Math.max(1, Number(config.maxPendingHostRequests) || 128);
  maxLogNotifications = Math.max(1, Number(config.maxLogNotifications) || 512);
  maxTotalNotifications = Math.max(
    maxLogNotifications,
    Number(config.maxTotalNotifications) || 20_000,
  );
  heartbeat = new BigInt64Array(config.heartbeatBuffer);
  const heartbeatIntervalMs = Math.max(2, Number(config.heartbeatIntervalMs) || 10);
  runtimeSnapshot = {
    session: {
      connected: Boolean(config.snapshot?.session?.connected),
      name: String(config.snapshot?.session?.name || ""),
      hostname: String(config.snapshot?.session?.hostname || ""),
      username: String(config.snapshot?.session?.username || ""),
    },
    screen: {
      currentRow: Number(config.snapshot?.screen?.currentRow) || 0,
      rows: Number(config.snapshot?.screen?.rows) || 24,
      cols: Number(config.snapshot?.screen?.cols) || 80,
    },
  };
  nct = {
    session: sessionApi,
    screen: screenApi,
    dialog: dialogApi,
    progress: progressApi,
    version: String(config.version || "0.0.0"),
    sleep: sessionApi.sleep,
    log(message) { notifyHost("log", [String(message ?? "")]); },
  };
  heartbeatTimer = setInterval(beat, heartbeatIntervalMs);
  beat();
  try {
    const sandbox = {
      nct,
      SharedArrayBuffer: undefined,
      console: {
        log: (...args) => notifyHost("console.log", [args.map((arg) => String(arg)).join(" ")]),
      },
    };
    vm.createContext(sandbox, {
      codeGeneration: { strings: false, wasm: false },
    });
    const script = new vm.Script(config.source, {
      filename: config.filename || "netcatty-script.js",
    });
    const result = script.runInContext(sandbox, { displayErrors: true });
    if (result && typeof result.then === "function") await result;
    finished = true;
    clearInterval(heartbeatTimer);
    parentPort.postMessage({ type: "completed" });
  } catch (error) {
    finished = true;
    clearInterval(heartbeatTimer);
    parentPort.postMessage({ type: "failed", error: serializeError(error) });
  }
}

parentPort.postMessage({ type: "ready" });
