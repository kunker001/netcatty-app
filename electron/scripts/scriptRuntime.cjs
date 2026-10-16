"use strict";

const path = require("node:path");
const { AsyncLocalStorage } = require("node:async_hooks");
const { Worker } = require("node:worker_threads");
const { shellPromptPatterns } = require("./shellPromptPatterns.cjs");

const SCRIPT_SYNC_EXECUTION_TIMEOUT_MS = 1_000;
const SCRIPT_WORKER_START_TIMEOUT_MS = 10_000;
const SCRIPT_WORKER_MAX_OLD_GENERATION_MB = 64;
const SCRIPT_WORKER_MAX_YOUNG_GENERATION_MB = 16;
const SCRIPT_WORKER_MAX_PENDING_HOST_REQUESTS = 128;
const SCRIPT_WORKER_MAX_LOG_NOTIFICATIONS = 512;
const SCRIPT_WORKER_MAX_TOTAL_NOTIFICATIONS = 20_000;
const SCRIPT_WORKER_IMMEDIATE_PROGRESS_NOTIFICATIONS = 64;
const SCRIPT_WORKER_PROGRESS_THROTTLE_MS = 50;
const activeScriptWorkers = new Set();
const activeScriptHostRequests = new Set();
let prewarmedScriptWorker = null;

function createScriptWorkerHandle() {
  const worker = new Worker(path.join(__dirname, "scriptExecutionWorker.cjs"), {
    resourceLimits: {
      maxOldGenerationSizeMb: SCRIPT_WORKER_MAX_OLD_GENERATION_MB,
      maxYoungGenerationSizeMb: SCRIPT_WORKER_MAX_YOUNG_GENERATION_MB,
      stackSizeMb: 4,
    },
  });
  worker.unref();
  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const onMessage = (message) => {
    if (message?.type !== "ready") return;
    worker.removeListener("message", onMessage);
    worker.removeListener("error", onStartupError);
    resolveReady();
  };
  const onStartupError = (error) => {
    worker.removeListener("message", onMessage);
    rejectReady(error);
  };
  worker.on("message", onMessage);
  worker.once("error", onStartupError);
  void readyPromise.catch(() => {});
  return { worker, readyPromise };
}

function ensurePrewarmedScriptWorker() {
  if (prewarmedScriptWorker) return prewarmedScriptWorker;
  const handle = createScriptWorkerHandle();
  prewarmedScriptWorker = handle;
  void handle.readyPromise.catch(() => {
    if (prewarmedScriptWorker === handle) prewarmedScriptWorker = null;
  });
  return handle;
}

function acquireScriptWorker() {
  const handle = prewarmedScriptWorker || createScriptWorkerHandle();
  if (prewarmedScriptWorker === handle) prewarmedScriptWorker = null;
  handle.worker.ref();
  ensurePrewarmedScriptWorker();
  return handle;
}

function wrapScriptSource(source) {
  const trimmed = String(source || "").trim();
  if (!trimmed) {
    throw new Error("Script content is empty");
  }

  if (/^\(\s*async\s*\(\s*\)\s*=>/m.test(trimmed) || /^\(\s*async\s+function\s*\(\s*\)\s*\{/m.test(trimmed)) {
    return trimmed;
  }

  const hasMainFunction = /\basync\s+function\s+main\s*\(/m.test(trimmed) || /\bfunction\s+main\s*\(/m.test(trimmed);
  if (hasMainFunction) {
    const body = trimmed.replace(/\n\s*;?\s*await\s+main\s*\(\s*\)\s*;?\s*$/m, "").trimEnd();
    const invokeMain = /\basync\s+function\s+main\s*\(/m.test(body)
      ? "await main();"
      : "await Promise.resolve(main());";
    return `(async () => {\n${body}\n${invokeMain}\n})();`;
  }

  return `(async () => {\n${trimmed}\n})();`;
}

function serializeWorkerError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    stack: typeof error?.stack === "string" ? error.stack : undefined,
  };
}

function reviveWorkerError(value) {
  const error = new Error(value?.message || "Script worker failed");
  error.name = value?.name || "Error";
  if (typeof value?.stack === "string") error.stack = value.stack;
  return error;
}

function readRuntimeSnapshot(nct) {
  return {
    session: {
      connected: Boolean(nct.session.connected),
      name: String(nct.session.name || ""),
      hostname: String(nct.session.hostname || ""),
      username: String(nct.session.username || ""),
    },
    screen: {
      currentRow: Number(nct.screen.currentRow) || 0,
      rows: Number(nct.screen.rows) || 24,
      cols: Number(nct.screen.cols) || 80,
    },
  };
}

const WORKER_RPC_METHODS = new Set([
  "session.sleep",
  "session.startLog",
  "session.stopLog",
  "session.disconnect",
  "screen.send",
  "screen.sendLine",
  "screen.waitFor",
  "screen.waitForText",
  "screen.waitForRegex",
  "screen.waitForPrompt",
  "screen.waitForAny",
  "screen.getText",
  "screen.clear",
  "dialog.alert",
  "dialog.confirm",
  "dialog.prompt",
  "dialog.form",
  "dialog.select",
  "dialog.radio",
  "dialog.checkbox",
]);

function invokeWorkerRpc(nct, method, args) {
  if (!WORKER_RPC_METHODS.has(method)) {
    throw new Error(`Unsupported script API method: ${method}`);
  }
  const [namespace, methodName] = method.split(".");
  const target = nct[namespace];
  const fn = target?.[methodName];
  if (typeof fn !== "function") {
    throw new Error(`Script API method unavailable: ${method}`);
  }
  return fn.apply(target, Array.isArray(args) ? args : []);
}

function handleWorkerNotification({ nct, appendLog, runId }, method, args) {
  if (method === "log") {
    nct.log(args?.[0]);
    return;
  }
  if (method === "console.log") {
    appendLog(runId, String(args?.[0] ?? ""));
    return;
  }
  if (method.startsWith("progress.")) {
    const methodName = method.slice("progress.".length);
    const fn = nct.progress?.[methodName];
    if (typeof fn !== "function") throw new Error(`Unsupported script notification: ${method}`);
    fn.apply(nct.progress, Array.isArray(args) ? args : []);
    return;
  }
  throw new Error(`Unsupported script notification: ${method}`);
}

function executeInScriptWorker({
  source,
  runId,
  nct,
  appendLog,
  isAborted,
  syncExecutionTimeoutMs,
  registerStop,
  executionContext,
  executionToken,
}) {
  const heartbeatIntervalMs = Math.max(
    2,
    Math.min(50, Math.floor(syncExecutionTimeoutMs / 4) || 2),
  );
  const heartbeatBuffer = new SharedArrayBuffer(BigInt64Array.BYTES_PER_ELEMENT);
  const heartbeat = new BigInt64Array(heartbeatBuffer);
  Atomics.store(heartbeat, 0, BigInt(Date.now()));
  const workerHandle = acquireScriptWorker();
  const { worker } = workerHandle;
  activeScriptWorkers.add(worker);

  return new Promise((resolve, reject) => {
    let settled = false;
    let ready = false;
    let watchdog = null;
    const pendingHostRequests = new Set();
    let notificationCount = 0;
    let logNotificationCount = 0;
    let progressNotificationCount = 0;
    let pendingProgressNotification = null;
    let progressTimer = null;
    let progressCurrent = 0;
    let progressTotal = 1;
    let rejectHostRequests;
    const hostRequestsClosed = new Promise((_, rejectClosed) => {
      rejectHostRequests = rejectClosed;
    });
    void hostRequestsClosed.catch(() => {});

    const cleanup = () => {
      clearTimeout(startTimer);
      if (watchdog) clearInterval(watchdog);
      if (progressTimer) clearTimeout(progressTimer);
      watchdog = null;
      progressTimer = null;
      pendingProgressNotification = null;
      worker.removeAllListeners();
      registerStop?.(() => {});
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      executionToken.closed = true;
      rejectHostRequests?.(error || new Error("Script execution finished"));
      const pendingDrain = Promise.allSettled([...pendingHostRequests]);
      cleanup();
      void Promise.all([
        worker.terminate().catch(() => {}),
        pendingDrain,
      ]).then(() => {
        pendingHostRequests.clear();
        activeScriptWorkers.delete(worker);
        if (error) reject(error);
        else resolve(undefined);
      });
    };
    registerStop?.((reason) => {
      finish(reason instanceof Error ? reason : new Error("Script stopped"));
    });
    const postSnapshot = () => {
      if (settled) return;
      try {
        worker.postMessage({ type: "snapshot", snapshot: readRuntimeSnapshot(nct) });
      } catch {
        // Worker may have crossed its terminal boundary between the checks.
      }
    };
    const deliverNotification = (message) => {
      executionContext.run(executionToken, () => {
        handleWorkerNotification({ nct, appendLog, runId }, message.method, message.args);
      });
    };
    const flushPendingProgress = () => {
      if (progressTimer) clearTimeout(progressTimer);
      progressTimer = null;
      const pending = pendingProgressNotification;
      pendingProgressNotification = null;
      if (!pending || settled) return;
      deliverNotification(pending);
    };
    const scheduleProgressFlush = () => {
      if (progressTimer || settled) return;
      progressTimer = setTimeout(() => {
        progressTimer = null;
        try {
          flushPendingProgress();
        } catch (error) {
          finish(error);
        }
      }, SCRIPT_WORKER_PROGRESS_THROTTLE_MS);
      progressTimer.unref?.();
    };
    const handleProgressNotification = (message) => {
      const methodName = message.method.slice("progress.".length);
      if (methodName === "start") {
        flushPendingProgress();
        progressCurrent = 0;
        progressTotal = Math.max(1, Number(message.args?.[1]) || 1);
      } else if (methodName === "set") {
        progressCurrent = Math.max(0, Math.min(progressTotal, Number(message.args?.[0]) || 0));
      } else if (methodName === "step") {
        progressCurrent = Math.min(progressTotal, progressCurrent + 1);
      } else if (methodName === "done") {
        flushPendingProgress();
      }

      progressNotificationCount += 1;
      if (
        progressNotificationCount <= SCRIPT_WORKER_IMMEDIATE_PROGRESS_NOTIFICATIONS
        || methodName === "start"
        || methodName === "done"
      ) {
        deliverNotification(message);
        return;
      }
      pendingProgressNotification = {
        type: "notify",
        method: "progress.set",
        args: [progressCurrent, message.args?.[1] ?? message.args?.[0]],
      };
      scheduleProgressFlush();
    };
    const startTimer = setTimeout(() => {
      finish(new Error(`Script worker failed to start after ${SCRIPT_WORKER_START_TIMEOUT_MS}ms`));
    }, SCRIPT_WORKER_START_TIMEOUT_MS);
    startTimer.unref?.();

    const startWatchdog = () => {
      if (watchdog || settled) return;
      const checkIntervalMs = Math.max(2, Math.min(25, heartbeatIntervalMs));
      watchdog = setInterval(() => {
        if (isAborted?.()) {
          finish(new Error("Script stopped"));
          return;
        }
        const lastHeartbeat = Number(Atomics.load(heartbeat, 0));
        if (Date.now() - lastHeartbeat > syncExecutionTimeoutMs + heartbeatIntervalMs) {
          finish(new Error(`Script execution timed out after ${syncExecutionTimeoutMs}ms`));
          return;
        }
        postSnapshot();
      }, checkIntervalMs);
      watchdog.unref?.();
    };

    worker.on("message", (message) => {
      if (settled) return;
      if (message?.type === "notify") {
        try {
          notificationCount += 1;
          if (notificationCount > SCRIPT_WORKER_MAX_TOTAL_NOTIFICATIONS) {
            finish(new Error(
              `Script exceeded the ${SCRIPT_WORKER_MAX_TOTAL_NOTIFICATIONS} notification limit`,
            ));
            return;
          }
          if (message.method === "log" || message.method === "console.log") {
            flushPendingProgress();
            logNotificationCount += 1;
            if (logNotificationCount > SCRIPT_WORKER_MAX_LOG_NOTIFICATIONS) {
              finish(new Error(
                `Script exceeded the ${SCRIPT_WORKER_MAX_LOG_NOTIFICATIONS} log notification limit`,
              ));
              return;
            }
            deliverNotification(message);
            return;
          }
          if (message.method?.startsWith("progress.")) {
            handleProgressNotification(message);
            return;
          }
          flushPendingProgress();
          deliverNotification(message);
        } catch (error) {
          finish(error);
        }
        return;
      }
      if (message?.type === "rpc") {
        if (pendingHostRequests.size >= SCRIPT_WORKER_MAX_PENDING_HOST_REQUESTS) {
          finish(new Error(
            `Script exceeded the ${SCRIPT_WORKER_MAX_PENDING_HOST_REQUESTS} pending host request limit`,
          ));
          return;
        }
        const hostRequest = executionContext.run(executionToken, () => (
          Promise.resolve().then(() => invokeWorkerRpc(nct, message.method, message.args))
        ));
        // The underlying API observes executionToken and normally stops itself.
        // Race it as well so one misbehaving host API cannot keep bookkeeping,
        // timers, or the script completion promise alive after worker teardown.
        void hostRequest.catch(() => {});
        const request = Promise.race([hostRequest, hostRequestsClosed]);
        pendingHostRequests.add(request);
        activeScriptHostRequests.add(request);
        void request.then(
          (value) => {
            if (settled) return;
            worker.postMessage({
              type: "rpc-result",
              requestId: message.requestId,
              ok: true,
              value,
              snapshot: readRuntimeSnapshot(nct),
            });
          },
          (error) => {
            if (settled) return;
            worker.postMessage({
              type: "rpc-result",
              requestId: message.requestId,
              ok: false,
              error: serializeWorkerError(error),
              snapshot: readRuntimeSnapshot(nct),
            });
          },
        ).finally(() => {
          pendingHostRequests.delete(request);
          activeScriptHostRequests.delete(request);
        }).catch((error) => {
          if (!settled) finish(error);
        });
        return;
      }
      if (message?.type === "completed") {
        try { flushPendingProgress(); } catch (error) {
          finish(error);
          return;
        }
        finish();
        return;
      }
      if (message?.type === "failed") {
        finish(reviveWorkerError(message.error));
      }
    });
    worker.once("error", (error) => finish(error));
    worker.once("exit", (code) => {
      if (!settled) {
        finish(new Error(
          ready
            ? `Script worker exited before completion (code ${code})`
            : `Script worker failed to start (code ${code})`,
        ));
      }
    });
    void workerHandle.readyPromise.then(() => {
      if (settled) return;
      ready = true;
      clearTimeout(startTimer);
      Atomics.store(heartbeat, 0, BigInt(Date.now()));
      worker.postMessage({
        type: "start",
        config: {
          source,
          filename: `script-${runId}.js`,
          version: nct.version,
          snapshot: readRuntimeSnapshot(nct),
          heartbeatBuffer,
          heartbeatIntervalMs,
          maxPendingHostRequests: SCRIPT_WORKER_MAX_PENDING_HOST_REQUESTS,
          maxLogNotifications: SCRIPT_WORKER_MAX_LOG_NOTIFICATIONS,
          maxTotalNotifications: SCRIPT_WORKER_MAX_TOTAL_NOTIFICATIONS,
        },
      });
      startWatchdog();
    }, (error) => finish(error));
  });
}

function truncateActivityLabel(value, max = 80) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function normalizeDialogOption(option) {
  if (typeof option === "string") {
    if (!option) {
      throw new Error("Dialog option value is required");
    }
    return {
      label: option,
      value: option,
      description: undefined,
      disabled: false,
    };
  }
  if (!option || typeof option !== "object") {
    throw new Error("Dialog option must be a string or object");
  }
  const value = String(option.value ?? "");
  if (!value) {
    throw new Error("Dialog option value is required");
  }
  return {
    label: String(option.label ?? value),
    value,
    description: option.description == null ? undefined : String(option.description),
    disabled: Boolean(option.disabled),
  };
}

function normalizeChoiceOptions(fieldType, options, defaultValue) {
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error(`Dialog ${fieldType} field requires at least one option`);
  }
  const normalizedOptions = options.map(normalizeDialogOption);
  const seenValues = new Set();
  for (const option of normalizedOptions) {
    if (seenValues.has(option.value)) {
      throw new Error(`Dialog ${fieldType} field option values must be unique: ${option.value}`);
    }
    seenValues.add(option.value);
  }
  const firstEnabled = normalizedOptions.find((option) => !option.disabled);
  if (!firstEnabled) {
    throw new Error(`Dialog ${fieldType} field requires at least one enabled option`);
  }
  const defaultText = defaultValue == null ? undefined : String(defaultValue);
  const selected = normalizedOptions.find((option) => option.value === defaultText && !option.disabled);
  return {
    options: normalizedOptions,
    defaultValue: selected ? selected.value : firstEnabled.value,
  };
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeConditionValue(value, context) {
  const valueType = typeof value;
  if (valueType === "string" || valueType === "boolean") {
    return value;
  }
  if (valueType === "number" && Number.isFinite(value)) {
    return value;
  }
  throw new Error(`${context} must be a string, number, or boolean`);
}

function normalizeDialogCondition(condition, context = "Dialog visibleWhen") {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) {
    throw new Error(`${context} must be an object`);
  }
  const field = String(condition.field ?? "").trim();
  if (!field) {
    throw new Error(`${context} field is required`);
  }
  const operators = ["equals", "notEquals", "truthy", "falsy"].filter((operator) => hasOwn(condition, operator));
  if (operators.length !== 1) {
    throw new Error(`${context} requires exactly one condition operator`);
  }
  const operator = operators[0];
  if (operator === "truthy" || operator === "falsy") {
    if (condition[operator] !== true) {
      throw new Error(`${context} ${operator} must be true`);
    }
    return { field, [operator]: true };
  }
  return {
    field,
    [operator]: normalizeConditionValue(condition[operator], `${context} ${operator}`),
  };
}

function matchesNumberStep(value, step, base = 0) {
  const quotient = (value - base) / step;
  return Math.abs(quotient - Math.round(quotient)) < 1e-9;
}

function normalizeDialogField(field, seenNames) {
  if (!field || typeof field !== "object") {
    throw new Error("Dialog form field must be an object");
  }
  const type = String(field.type ?? "");
  if (!["select", "checkbox", "radio", "textarea", "number"].includes(type)) {
    throw new Error(`Unsupported dialog field type: ${type || "unknown"}`);
  }
  const name = String(field.name ?? "").trim();
  if (!name) {
    throw new Error("Dialog form field name is required");
  }
  if (["__proto__", "prototype", "constructor"].includes(name)) {
    throw new Error(`Dialog form field name is reserved: ${name}`);
  }
  if (seenNames.has(name)) {
    throw new Error(`Duplicate dialog form field name: ${name}`);
  }
  seenNames.add(name);

  const base = {
    type,
    name,
    label: String(field.label ?? name),
    description: field.description == null ? undefined : String(field.description),
    required: field.required !== false,
    visibleWhen: field.visibleWhen == null ? undefined : normalizeDialogCondition(field.visibleWhen),
  };

  if (type === "checkbox") {
    return {
      ...base,
      required: field.required === true,
      defaultValue: Boolean(field.defaultValue),
    };
  }

  if (type === "textarea") {
    return {
      ...base,
      placeholder: field.placeholder == null ? undefined : String(field.placeholder),
      defaultValue: field.defaultValue == null ? "" : String(field.defaultValue),
    };
  }

  if (type === "number") {
    const defaultNumber = field.defaultValue === undefined || field.defaultValue === null || field.defaultValue === ""
      ? undefined
      : Number(field.defaultValue);
    if (defaultNumber !== undefined && !Number.isFinite(defaultNumber)) {
      throw new Error(`Dialog number field defaultValue must be a finite number: ${name}`);
    }
    const min = field.min === undefined || field.min === null || field.min === "" ? undefined : Number(field.min);
    const max = field.max === undefined || field.max === null || field.max === "" ? undefined : Number(field.max);
    const step = field.step === undefined || field.step === null || field.step === "" ? undefined : Number(field.step);
    if (min !== undefined && !Number.isFinite(min)) {
      throw new Error(`Dialog number field min must be a finite number: ${name}`);
    }
    if (max !== undefined && !Number.isFinite(max)) {
      throw new Error(`Dialog number field max must be a finite number: ${name}`);
    }
    if (step !== undefined && (!Number.isFinite(step) || step <= 0)) {
      throw new Error(`Dialog number field step must be a positive finite number: ${name}`);
    }
    if (min !== undefined && max !== undefined && min > max) {
      throw new Error(`Dialog number field min cannot be greater than max: ${name}`);
    }
    if (defaultNumber !== undefined && min !== undefined && defaultNumber < min) {
      throw new Error(`Dialog number field defaultValue cannot be less than min: ${name}`);
    }
    if (defaultNumber !== undefined && max !== undefined && defaultNumber > max) {
      throw new Error(`Dialog number field defaultValue cannot be greater than max: ${name}`);
    }
    if (
      defaultNumber !== undefined
      && step !== undefined
      && min !== undefined
      && !matchesNumberStep(defaultNumber, step, min)
    ) {
      throw new Error(`Dialog number field defaultValue must match step from min: ${name}`);
    }
    return {
      ...base,
      placeholder: field.placeholder == null ? undefined : String(field.placeholder),
      defaultValue: defaultNumber,
      min,
      max,
      step,
    };
  }

  const choice = normalizeChoiceOptions(type, field.options, field.defaultValue);
  return {
    ...base,
    options: choice.options,
    defaultValue: choice.defaultValue,
  };
}

function normalizeDialogFormSpec(spec) {
  if (!spec || typeof spec !== "object") {
    throw new Error("Dialog form spec must be an object");
  }
  if (!Array.isArray(spec.fields) || spec.fields.length === 0) {
    throw new Error("Dialog form requires at least one field");
  }
  const seenNames = new Set();
  const fields = spec.fields.map((field) => normalizeDialogField(field, seenNames));
  const fieldIndexByName = new Map(fields.map((field, index) => [field.name, index]));
  for (const [index, field] of fields.entries()) {
    if (field.visibleWhen && !seenNames.has(field.visibleWhen.field)) {
      throw new Error(`Dialog visibleWhen references unknown field: ${field.visibleWhen.field}`);
    }
    const dependencyIndex = field.visibleWhen ? fieldIndexByName.get(field.visibleWhen.field) : undefined;
    if (dependencyIndex !== undefined && dependencyIndex >= index) {
      throw new Error(`Dialog visibleWhen must reference an earlier field: ${field.name}`);
    }
  }
  return {
    title: spec.title == null ? undefined : String(spec.title),
    message: spec.message == null ? "" : String(spec.message),
    submitLabel: spec.submitLabel == null ? undefined : String(spec.submitLabel),
    cancelLabel: spec.cancelLabel == null ? undefined : String(spec.cancelLabel),
    fields,
  };
}

function createScriptRuntime(deps) {
  ensurePrewarmedScriptWorker();
  const {
    sessionId,
    runId,
    appendLog,
    writeToSession,
    getOutputBuffer,
    getScreenSnapshot,
    getSessionMeta,
    showDialog,
    showWaitForTimeoutDialog,
    disconnectSession,
    startSessionLog,
    stopSessionLog,
    onStatusChange,
    isPaused,
    permissionMode = "auto",
    startedAt = Date.now(),
  } = deps;

  let stepIndex = 0;
  let progressMode = "activity";
  let progressLabel;
  let progressCurrent = 0;
  let progressTotal = 0;
  let stopActiveExecution = () => {};
  const executionContext = new AsyncLocalStorage();

  let screenSnapshot = {
    rows: 24,
    cols: 80,
    currentRow: 0,
    lines: [],
  };

  function isExecutionAborted() {
    return Boolean(executionContext.getStore()?.closed || deps.isAborted?.());
  }

  function assertNotAborted() {
    if (isExecutionAborted()) {
      throw new Error("Script stopped");
    }
  }

  function abortable(promise) {
    assertNotAborted();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        callback(value);
      };
      const timer = setInterval(() => {
        if (!isExecutionAborted()) return;
        finish(reject, new Error("Script stopped"));
      }, 50);
      Promise.resolve(promise).then(
        (value) => {
          if (isExecutionAborted()) {
            finish(reject, new Error("Script stopped"));
            return;
          }
          finish(resolve, value);
        },
        (err) => {
          if (isExecutionAborted()) {
            finish(reject, new Error("Script stopped"));
            return;
          }
          finish(reject, err);
        },
      );
    });
  }

  function markHandled(promise) {
    const observed = Promise.resolve(promise);
    observed.catch(() => {});
    return promise;
  }

  async function ignoreIfStopped(task) {
    try {
      return await task();
    } catch (err) {
      if (isExecutionAborted() && err?.message === "Script stopped") {
        return undefined;
      }
      throw err;
    }
  }

  function emitStatus(patch = {}) {
    onStatusChange?.(runId, {
      progressMode,
      progressLabel: progressMode === "determinate" ? progressLabel : undefined,
      progressCurrent: progressMode === "determinate" ? progressCurrent : undefined,
      progressTotal: progressMode === "determinate" ? progressTotal : undefined,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      stepIndex,
      status: "running",
      ...patch,
    });
  }

  function assertWriteAllowed(operation) {
    if (permissionMode !== "observer") return;
    throw new Error(`Observer mode: ${operation} is disabled. Switch to Confirm or Auto mode.`);
  }

  async function trackStep(label) {
    assertNotAborted();
    stepIndex += 1;
    const activityLabel = truncateActivityLabel(label);
    emitStatus({
      activityLabel,
      currentStep: activityLabel,
    });
  }

  async function refreshScreenSnapshot() {
    assertNotAborted();
    if (typeof getScreenSnapshot === "function") {
      try {
        screenSnapshot = await abortable(getScreenSnapshot(sessionId));
      } catch {
        // fall back to output buffer text
      }
    }
    assertNotAborted();
    return screenSnapshot;
  }

  async function waitForPromptWithRecovery(timeoutMs = 60000) {
    let stepTracked = false;
    while (true) {
      if (isExecutionAborted()) {
        throw new Error("Script stopped");
      }
      if (!stepTracked) {
        await trackStep("waitForPrompt");
        stepTracked = true;
      }
      onStatusChange?.(runId, { waitingFor: "shell prompt", status: "running", elapsedMs: Math.max(0, Date.now() - startedAt) });
      try {
        return await getOutputBuffer(sessionId).waitForAny(
          shellPromptPatterns(),
          timeoutMs,
          isExecutionAborted,
          { allowPreservedTailMatch: true },
        );
      } catch (err) {
        if (!String(err?.message || err).includes("timed out")) {
          throw err;
        }
        onStatusChange?.(runId, { status: "paused", waitingFor: "shell prompt", elapsedMs: Math.max(0, Date.now() - startedAt) });
        assertNotAborted();
        const action = await abortable(showWaitForTimeoutDialog?.("shell prompt", timeoutMs));
        onStatusChange?.(runId, { status: "running" });
        if (action === "retry") {
          continue;
        }
        if (action === "skip") {
          return -1;
        }
        throw new Error("Script stopped by user");
      } finally {
        onStatusChange?.(runId, { waitingFor: undefined, status: "running", elapsedMs: Math.max(0, Date.now() - startedAt) });
      }
    }
  }

  async function waitForAnyWithRecovery(patterns, timeoutMs = 30000) {
    const label = Array.isArray(patterns)
      ? patterns.map((pattern) => (pattern instanceof RegExp ? pattern.source : String(pattern))).join(" | ")
      : String(patterns);
    let stepTracked = false;
    while (true) {
      if (isExecutionAborted()) {
        throw new Error("Script stopped");
      }
      if (!stepTracked) {
        await trackStep(`waitForAny ${truncateActivityLabel(label, 60)}`);
        stepTracked = true;
      }
      onStatusChange?.(runId, { waitingFor: label, status: "running", elapsedMs: Math.max(0, Date.now() - startedAt) });
      try {
        return await getOutputBuffer(sessionId).waitForAny(
          patterns,
          timeoutMs,
          isExecutionAborted,
        );
      } catch (err) {
        if (!String(err?.message || err).includes("timed out")) {
          throw err;
        }
        onStatusChange?.(runId, { status: "paused", waitingFor: label, elapsedMs: Math.max(0, Date.now() - startedAt) });
        assertNotAborted();
        const action = await abortable(showWaitForTimeoutDialog?.(label, timeoutMs));
        onStatusChange?.(runId, { status: "running" });
        if (action === "retry") {
          continue;
        }
        if (action === "skip") {
          return -1;
        }
        throw new Error("Script stopped by user");
      } finally {
        onStatusChange?.(runId, { waitingFor: undefined, status: "running", elapsedMs: Math.max(0, Date.now() - startedAt) });
      }
    }
  }

  async function waitForWithRecovery(pattern, timeoutMs = 30000, options = {}) {
    const waitMethod = options.waitMethod || "waitFor";
    const operationLabel = options.operationLabel || waitMethod;
    const patternLabel = pattern instanceof RegExp ? pattern.source : String(pattern);
    let stepTracked = false;
    while (true) {
      if (isExecutionAborted()) {
        throw new Error("Script stopped");
      }
      if (!stepTracked) {
        await trackStep(`${operationLabel} ${truncateActivityLabel(patternLabel, 60)}`);
        stepTracked = true;
      }
      onStatusChange?.(runId, { waitingFor: patternLabel, status: "running", elapsedMs: Math.max(0, Date.now() - startedAt) });
      try {
        return await getOutputBuffer(sessionId)[waitMethod](
          pattern,
          timeoutMs,
          isExecutionAborted,
        );
      } catch (err) {
        if (!String(err?.message || err).includes("timed out")) {
          throw err;
        }
        onStatusChange?.(runId, { status: "paused", waitingFor: patternLabel, elapsedMs: Math.max(0, Date.now() - startedAt) });
        assertNotAborted();
        const action = await abortable(showWaitForTimeoutDialog?.(patternLabel, timeoutMs));
        onStatusChange?.(runId, { status: "running" });
        if (action === "retry") {
          continue;
        }
        if (action === "skip") {
          return "";
        }
        throw new Error("Script stopped by user");
      } finally {
        onStatusChange?.(runId, { waitingFor: undefined, status: "running", elapsedMs: Math.max(0, Date.now() - startedAt) });
      }
    }
  }

  const progressApi = {
    start(label, total) {
      progressMode = "determinate";
      progressLabel = truncateActivityLabel(label || "Progress", 60);
      progressTotal = Math.max(1, Number(total) || 1);
      progressCurrent = 0;
      emitStatus({
        progressMode,
        progressLabel,
        progressCurrent,
        progressTotal,
        activityLabel: progressLabel,
      });
    },
    set(current, detail) {
      if (progressMode !== "determinate") return;
      progressCurrent = Math.max(0, Math.min(progressTotal, Number(current) || 0));
      const patch = {
        progressCurrent,
        progressTotal,
        progressLabel,
      };
      if (detail !== undefined && detail !== null && detail !== "") {
        patch.activityLabel = truncateActivityLabel(detail);
      }
      emitStatus(patch);
    },
    step(detail) {
      if (progressMode !== "determinate") return;
      progressCurrent = Math.min(progressTotal, progressCurrent + 1);
      const patch = {
        progressCurrent,
        progressTotal,
        progressLabel,
      };
      if (detail !== undefined && detail !== null && detail !== "") {
        patch.activityLabel = truncateActivityLabel(detail);
      }
      emitStatus(patch);
    },
    done() {
      if (progressMode !== "determinate") return;
      progressCurrent = progressTotal;
      emitStatus({
        progressCurrent,
        progressTotal,
        progressLabel,
      });
      progressMode = "activity";
      progressLabel = undefined;
      progressCurrent = 0;
      progressTotal = 0;
      emitStatus({
        progressMode: "activity",
        progressLabel: undefined,
        progressCurrent: undefined,
        progressTotal: undefined,
      });
    },
  };

  const sessionApi = {
    get connected() {
      const meta = getSessionMeta?.(sessionId);
      return Boolean(meta?.connected);
    },
    get name() {
      return getSessionMeta?.(sessionId)?.name || "";
    },
    get hostname() {
      return getSessionMeta?.(sessionId)?.hostname || "";
    },
    get username() {
      return getSessionMeta?.(sessionId)?.username || "";
    },
    sleep(ms) {
      const delay = Math.max(0, Number(ms) || 0);
      return markHandled(trackStep(`sleep ${delay}ms`).then(() => interruptibleSleep(delay, isExecutionAborted)));
    },
    startLog(path) {
      return markHandled(ignoreIfStopped(async () => {
        if (isExecutionAborted()) return;
        assertWriteAllowed("session.startLog");
        await trackStep("startLog");
        if (isExecutionAborted()) return;
        await startSessionLog?.(sessionId, path);
      }));
    },
    stopLog() {
      return markHandled((async () => {
        await stopSessionLog?.(sessionId);
      })());
    },
    disconnect() {
      return markHandled(ignoreIfStopped(async () => {
        if (isExecutionAborted()) return;
        assertWriteAllowed("session.disconnect");
        await trackStep("disconnect");
        if (isExecutionAborted()) return;
        await disconnectSession?.(sessionId);
      }));
    },
  };

  const screenApi = {
    send(text, options = {}) {
      return markHandled(ignoreIfStopped(async () => {
        if (isExecutionAborted()) return;
        assertWriteAllowed("screen.send");
        await waitIfPaused();
        const payload = String(text ?? "");
        const sensitive = options?.sensitive === true;
        const visiblePayload = sensitive ? "[sensitive]" : formatScriptInputForLog(payload);
        await trackStep(`send: ${truncateActivityLabel(visiblePayload, 60)}`);
        if (isExecutionAborted()) return;
        appendLog(runId, `→ ${visiblePayload}`);
        writeToSession(sessionId, payload, { automated: true, sensitive });
      }));
    },
    sendLine(text, options = {}) {
      return markHandled(ignoreIfStopped(async () => {
        if (isExecutionAborted()) return;
        assertWriteAllowed("screen.sendLine");
        await waitIfPaused();
        const line = String(text ?? "");
        const sensitive = options?.sensitive === true;
        const visibleLine = sensitive ? "[sensitive]" : line;
        await trackStep(`sendLine: ${truncateActivityLabel(visibleLine, 60)}`);
        if (isExecutionAborted()) return;
        appendLog(runId, `→ ${visibleLine}`);
        // Bastion menus can ignore a single "line\r" packet even when
        // stream.write succeeds. Match xterm: body, then Enter (#1960).
        // Consume only pre-send buffer length so prompts that arrive between
        // body and CR stay waitable for the next step.
        const buffer = getOutputBuffer(sessionId);
        const lengthBeforeSend = buffer.getText().length;
        if (line.length > 0) {
          writeToSession(sessionId, line, {
            automated: true,
            sensitive,
            invalidateStartupSeed: false,
          });
          await interruptibleSleep(30, isExecutionAborted);
          if (isExecutionAborted()) return;
        }
        writeToSession(sessionId, "\r", {
          automated: true,
          sensitive,
          invalidateStartupSeed: false,
        });
        buffer.consumeThroughAbsolute(lengthBeforeSend);
      }));
    },
    waitFor(pattern, timeoutMs = 30000) {
      return markHandled(waitForWithRecovery(pattern, timeoutMs));
    },
    waitForText(text, timeoutMs = 30000) {
      return markHandled(waitForWithRecovery(text, timeoutMs, {
        waitMethod: "waitForText",
        operationLabel: "waitForText",
      }));
    },
    waitForRegex(pattern, timeoutMs = 30000) {
      return markHandled(waitForWithRecovery(pattern, timeoutMs, {
        waitMethod: "waitForRegex",
        operationLabel: "waitForRegex",
      }));
    },
    waitForPrompt(timeoutMs = 60000) {
      return markHandled(waitForPromptWithRecovery(timeoutMs));
    },
    waitForAny(patterns, timeoutMs = 30000) {
      return markHandled(waitForAnyWithRecovery(patterns, timeoutMs));
    },
    getText(startRow, endRow) {
      return markHandled((async () => {
        await refreshScreenSnapshot();
        assertNotAborted();
        const lines = screenSnapshot.lines || [];
        const start = typeof startRow === "number" ? Math.max(0, startRow) : 0;
        const end = typeof endRow === "number" ? Math.min(lines.length - 1, endRow) : lines.length - 1;
        if (lines.length === 0) {
          return getOutputBuffer(sessionId).getText();
        }
        return lines.slice(start, end + 1).join("\n");
      })());
    },
    get currentRow() {
      return screenSnapshot.currentRow ?? 0;
    },
    get rows() {
      return screenSnapshot.rows ?? 24;
    },
    get cols() {
      return screenSnapshot.cols ?? 80;
    },
    clear() {
      return markHandled(ignoreIfStopped(async () => {
        if (isExecutionAborted()) return;
        assertWriteAllowed("screen.clear");
        await trackStep("clear");
        if (isExecutionAborted()) return;
        writeToSession(sessionId, "\x1b[2J\x1b[H", { automated: true });
      }));
    },
  };

  const dialogApi = {
    alert(message) {
      assertNotAborted();
      return markHandled(abortable(showDialog("alert", String(message ?? ""))));
    },
    confirm(message) {
      assertNotAborted();
      return markHandled(abortable(showDialog("confirm", String(message ?? ""))));
    },
    prompt(message, defaultValue = "", options = {}) {
      assertNotAborted();
      return markHandled(abortable(showDialog(
        "prompt",
        String(message ?? ""),
        String(defaultValue ?? ""),
        { sensitive: options?.sensitive === true },
      )));
    },
    form(spec) {
      assertNotAborted();
      const form = normalizeDialogFormSpec(spec);
      return markHandled(abortable(showDialog("form", form.message, undefined, { form })));
    },
    select(message, options, defaultValue) {
      return markHandled((async () => {
        const values = await dialogApi.form({
          message,
          fields: [{
            type: "select",
            name: "value",
            label: message,
            options,
            defaultValue,
          }],
        });
        return String(values?.value ?? "");
      })());
    },
    radio(message, options, defaultValue) {
      return markHandled((async () => {
        const values = await dialogApi.form({
          message,
          fields: [{
            type: "radio",
            name: "value",
            label: message,
            options,
            defaultValue,
          }],
        });
        return String(values?.value ?? "");
      })());
    },
    checkbox(message, defaultChecked = false) {
      return markHandled((async () => {
        const values = await dialogApi.form({
          message,
          fields: [{
            type: "checkbox",
            name: "value",
            label: message,
            defaultValue: defaultChecked,
          }],
        });
        return Boolean(values?.value);
      })());
    },
  };

  const nct = {
    session: sessionApi,
    screen: screenApi,
    dialog: dialogApi,
    progress: progressApi,
    version: deps.appVersion || "0.0.0",
    sleep: sessionApi.sleep.bind(sessionApi),
    log(message) {
      if (isExecutionAborted()) return;
      assertNotAborted();
      stepIndex += 1;
      emitStatus({
        activityLabel: "log",
        currentStep: "log",
      });
      appendLog(runId, String(message ?? ""));
    },
  };

  async function waitIfPaused() {
    assertNotAborted();
    while (isPaused?.()) {
      assertNotAborted();
      onStatusChange?.(runId, { status: "paused", elapsedMs: Math.max(0, Date.now() - startedAt) });
      await interruptibleSleep(100, isExecutionAborted);
    }
    assertNotAborted();
    onStatusChange?.(runId, { status: "running", elapsedMs: Math.max(0, Date.now() - startedAt) });
  }

  async function execute(source) {
    assertNotAborted();
    const executionToken = { closed: false };
    const configuredSyncTimeoutMs = Number(deps.syncExecutionTimeoutMs);
    const syncExecutionTimeoutMs = Number.isFinite(configuredSyncTimeoutMs) && configuredSyncTimeoutMs > 0
      ? Math.floor(configuredSyncTimeoutMs)
      : SCRIPT_SYNC_EXECUTION_TIMEOUT_MS;
    await executeInScriptWorker({
      source: wrapScriptSource(source),
      runId,
      nct,
      appendLog,
      isAborted: () => executionToken.closed || Boolean(deps.isAborted?.()),
      syncExecutionTimeoutMs,
      registerStop: (stop) => { stopActiveExecution = stop; },
      executionContext,
      executionToken,
    });
    assertNotAborted();
  }

  return {
    execute,
    nct,
    stop(reason = new Error("Script stopped")) {
      stopActiveExecution(reason);
    },
  };
}

function interruptibleSleep(ms, isAborted) {
  const delay = Math.max(0, Number(ms) || 0);
  if (!isAborted) {
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (isAborted()) {
        clearInterval(timer);
        reject(new Error("Script stopped"));
        return;
      }
      if (Date.now() - startedAt >= delay) {
        clearInterval(timer);
        resolve(undefined);
      }
    }, 50);
  });
}

function formatScriptInputForLog(data) {
  return String(data ?? "")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\x03/g, "^C")
    .replace(/\x1b/g, "\\e");
}

module.exports = {
  SCRIPT_WORKER_MAX_PENDING_HOST_REQUESTS,
  SCRIPT_WORKER_MAX_LOG_NOTIFICATIONS,
  SCRIPT_WORKER_MAX_TOTAL_NOTIFICATIONS,
  SCRIPT_WORKER_IMMEDIATE_PROGRESS_NOTIFICATIONS,
  SCRIPT_SYNC_EXECUTION_TIMEOUT_MS,
  createScriptRuntime,
  wrapScriptSource,
  interruptibleSleep,
  formatScriptInputForLog,
  normalizeDialogFormSpec,
  _getActiveScriptWorkerCountForTests: () => activeScriptWorkers.size,
  _getActiveScriptHostRequestCountForTests: () => activeScriptHostRequests.size,
};
