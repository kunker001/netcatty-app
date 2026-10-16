"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createScriptRuntime,
  SCRIPT_WORKER_MAX_PENDING_HOST_REQUESTS,
  SCRIPT_WORKER_MAX_LOG_NOTIFICATIONS,
  SCRIPT_WORKER_MAX_TOTAL_NOTIFICATIONS,
  SCRIPT_WORKER_IMMEDIATE_PROGRESS_NOTIFICATIONS,
  wrapScriptSource,
  interruptibleSleep,
  normalizeDialogFormSpec,
  _getActiveScriptWorkerCountForTests,
  _getActiveScriptHostRequestCountForTests,
} = require("./scriptRuntime.cjs");
const { SessionOutputBuffer } = require("./sessionOutputBuffer.cjs");

test("wrapScriptSource wraps async main scripts in async IIFE", () => {
  const wrapped = wrapScriptSource(`
// generated
async function main() {
  await nct.log('hi');
}

await main();
`);
  assert.match(wrapped, /^\(async \(\) => \{/);
  assert.match(wrapped, /await main\(\);\n\}\)\(\);$/);
});

test("wrapScriptSource wraps bare statements in async IIFE", () => {
  const wrapped = wrapScriptSource("await nct.log('hi');");
  assert.match(wrapped, /async \(\) =>/);
});

test("interruptibleSleep rejects when aborted", async () => {
  let aborted = false;
  const pending = interruptibleSleep(5000, () => aborted);
  setTimeout(() => {
    aborted = true;
  }, 50);
  await assert.rejects(pending, /Script stopped/);
});

test("createScriptRuntime executes async main script", async () => {
  const logs = [];
  const runtime = createScriptRuntime({
    sessionId: "s1",
    runId: "r1",
    appendLog: (_id, message) => logs.push(message),
    writeToSession: () => {},
    getOutputBuffer: () => ({
      waitFor: async () => "ok",
      waitForAny: async () => 0,
      getText: () => "",
    }),
    getSessionMeta: () => ({ connected: true, hostname: "host", username: "user" }),
    showDialog: async () => true,
    isPaused: () => false,
    isAborted: () => false,
    onStatusChange: () => {},
  });

  await runtime.execute(`
async function main() {
  nct.log('from-main');
}

await main();
`);
  assert.deepEqual(logs, ["from-main"]);
});

test("createScriptRuntime exposes the session name", async () => {
  const logs = [];
  const runtime = createScriptRuntime({
    sessionId: "s1",
    runId: "r1",
    appendLog: (_id, message) => logs.push(message),
    writeToSession: () => {},
    getOutputBuffer: () => ({
      waitFor: async () => "ok",
      waitForAny: async () => 0,
      getText: () => "",
    }),
    getSessionMeta: () => ({ connected: true, name: "Production", hostname: "host", username: "user" }),
    showDialog: async () => true,
    isPaused: () => false,
    isAborted: () => false,
    onStatusChange: () => {},
  });

  await runtime.execute("nct.log(nct.session.name);");
  assert.deepEqual(logs, ["Production"]);
});

test("createScriptRuntime releases its isolated worker after normal completion", async () => {
  const runtime = createScriptRuntime({
    sessionId: "s1",
    runId: "r-bounded-sync",
    appendLog: () => {},
    writeToSession: () => {},
    getOutputBuffer: () => ({ getText: () => "" }),
    getSessionMeta: () => ({ connected: true }),
    showDialog: async () => true,
    isPaused: () => false,
    isAborted: () => false,
    onStatusChange: () => {},
  });

  await runtime.execute("void 0;");
  assert.equal(_getActiveScriptWorkerCountForTests(), 0);
});

test("createScriptRuntime stops a synchronous infinite loop", async () => {
  const runtime = createScriptRuntime({
    sessionId: "s1",
    runId: "r-infinite-loop",
    appendLog: () => {},
    writeToSession: () => {},
    getOutputBuffer: () => ({ getText: () => "" }),
    getSessionMeta: () => ({ connected: true }),
    showDialog: async () => true,
    isPaused: () => false,
    isAborted: () => false,
    onStatusChange: () => {},
    syncExecutionTimeoutMs: 20,
  });

  await assert.rejects(runtime.execute("while (true) {}"), /timed out/i);
});

test("createScriptRuntime stop forcibly terminates a blocked worker", async () => {
  const runtime = createScriptRuntime({
    sessionId: "s1",
    runId: "r-explicit-stop",
    appendLog: () => {},
    writeToSession: () => {},
    getOutputBuffer: () => ({ getText: () => "" }),
    getSessionMeta: () => ({ connected: true }),
    showDialog: async () => true,
    isPaused: () => false,
    isAborted: () => false,
    onStatusChange: () => {},
    syncExecutionTimeoutMs: 5_000,
  });

  const startedAt = Date.now();
  const execution = runtime.execute(`
    await nct.sleep(1);
    /^(a+)+$/.test('a'.repeat(30) + '!');
  `);
  setTimeout(() => runtime.stop(new Error("Stopped by user")), 50);
  await assert.rejects(execution, /stopped by user/i);
  assert.ok(Date.now() - startedAt < 1_000, "explicit stop did not terminate the worker promptly");
  assert.equal(_getActiveScriptWorkerCountForTests(), 0);
});

test("createScriptRuntime enforces the worker deadline across promise continuations", async () => {
  const runtime = createScriptRuntime({
    sessionId: "s1",
    runId: "r-post-await-infinite-loop",
    appendLog: () => {},
    writeToSession: () => {},
    getOutputBuffer: () => ({ getText: () => "" }),
    getSessionMeta: () => ({ connected: true }),
    showDialog: async () => true,
    isPaused: () => false,
    isAborted: () => false,
    onStatusChange: () => {},
    syncExecutionTimeoutMs: 20,
  });

  await assert.rejects(
    runtime.execute("await Promise.resolve(); while (true) {}"),
    /timed out/i,
  );
  await assert.rejects(
    runtime.execute("await nct.sleep(1); while (true) {}"),
    /timed out/i,
  );
  await assert.rejects(
    runtime.execute(`
      await nct.sleep(1);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    `),
    /blocking atomics|sharedarraybuffer/i,
  );
  const startedAt = Date.now();
  await assert.rejects(
    runtime.execute(`
      await nct.sleep(1);
      /^(a+)+$/.test('a'.repeat(28) + '!');
    `),
    /timed out/i,
  );
  assert.ok(Date.now() - startedAt < 1_000, "catastrophic regexp was not terminated promptly");
  assert.equal(_getActiveScriptWorkerCountForTests(), 0);
});

test("createScriptRuntime drains normal host-backed promise continuations", async () => {
  const logs = [];
  const runtime = createScriptRuntime({
    sessionId: "s1",
    runId: "r-post-await-normal",
    appendLog: (_id, message) => logs.push(message),
    writeToSession: () => {},
    getOutputBuffer: () => ({ getText: () => "" }),
    getSessionMeta: () => ({ connected: true }),
    showDialog: async () => true,
    isPaused: () => false,
    isAborted: () => false,
    onStatusChange: () => {},
    syncExecutionTimeoutMs: 20,
  });

  await runtime.execute(`
    await nct.sleep(1);
    nct.log('first');
    await Promise.resolve();
    await nct.sleep(1);
    nct.log(nct.session.connected ? 'second' : 'disconnected');
  `);
  assert.deepEqual(logs, ["first", "second"]);
  assert.equal(_getActiveScriptWorkerCountForTests(), 0);
});

test("createScriptRuntime heartbeat remains healthy while a host request is paused", async () => {
  let paused = true;
  const writes = [];
  const runtime = createScriptRuntime({
    sessionId: "s1",
    runId: "r-paused-host-request",
    appendLog: () => {},
    writeToSession: (_sessionId, data) => writes.push(data),
    getOutputBuffer: () => ({ getText: () => "" }),
    getSessionMeta: () => ({ connected: true }),
    showDialog: async () => true,
    isPaused: () => paused,
    isAborted: () => false,
    onStatusChange: () => {},
    syncExecutionTimeoutMs: 250,
  });

  const execution = runtime.execute("await nct.screen.send('after-pause');");
  setTimeout(() => { paused = false; }, 400);
  await execution;
  assert.deepEqual(writes, ["after-pause"]);
  assert.equal(_getActiveScriptWorkerCountForTests(), 0);
});

test("createScriptRuntime terminates unawaited host requests at the worker boundary", async () => {
  let finishDialog;
  let disconnectCalls = 0;
  const runtime = createScriptRuntime({
    sessionId: "s1",
    runId: "r-unawaited-request",
    appendLog: () => {},
    writeToSession: () => {},
    getOutputBuffer: () => ({ getText: () => "" }),
    getSessionMeta: () => ({ connected: true }),
    showDialog: () => new Promise((resolve) => { finishDialog = resolve; }),
    disconnectSession: async () => { disconnectCalls += 1; },
    isPaused: () => false,
    isAborted: () => false,
    onStatusChange: () => {},
  });

  await runtime.execute(`
    void nct.dialog.confirm('background').then(() => nct.session.disconnect());
    nct.log('done');
  `);
  assert.equal(_getActiveScriptWorkerCountForTests(), 0);
  const cleanupStartedAt = Date.now();
  while (_getActiveScriptHostRequestCountForTests() > 0 && Date.now() - cleanupStartedAt < 500) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(_getActiveScriptHostRequestCountForTests(), 0);
  finishDialog(true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(disconnectCalls, 0);
});

test("createScriptRuntime terminates a 20k unawaited host-request fan-out at the pending limit", async () => {
  const runtime = createScriptRuntime({
    sessionId: "s1",
    runId: "r-host-request-fanout",
    appendLog: () => {},
    writeToSession: () => {},
    getOutputBuffer: () => ({ getText: () => "" }),
    getSessionMeta: () => ({ connected: true }),
    showDialog: async () => true,
    isPaused: () => false,
    isAborted: () => false,
    onStatusChange: () => {},
    syncExecutionTimeoutMs: 5_000,
  });

  const startedAt = Date.now();
  await assert.rejects(
    runtime.execute("for (let i = 0; i < 20000; i += 1) void nct.sleep(60000);"),
    new RegExp(`${SCRIPT_WORKER_MAX_PENDING_HOST_REQUESTS} pending host request limit`, "i"),
  );
  assert.ok(Date.now() - startedAt < 1_000, "fan-out was not stopped promptly");
  assert.equal(_getActiveScriptHostRequestCountForTests(), 0);
  assert.equal(_getActiveScriptWorkerCountForTests(), 0);
});

test("createScriptRuntime still permits normal sequential host requests", async () => {
  const logs = [];
  const runtime = createScriptRuntime({
    sessionId: "s1",
    runId: "r-sequential-host-requests",
    appendLog: (_id, message) => logs.push(message),
    writeToSession: () => {},
    getOutputBuffer: () => ({ getText: () => "" }),
    getSessionMeta: () => ({ connected: true }),
    showDialog: async () => true,
    isPaused: () => false,
    isAborted: () => false,
    onStatusChange: () => {},
  });

  await runtime.execute(`
    for (let i = 0; i < 5; i += 1) await nct.sleep(0);
    nct.log('done');
  `);
  assert.deepEqual(logs, ["done"]);
  assert.equal(_getActiveScriptHostRequestCountForTests(), 0);
});

test("createScriptRuntime bounds a 200k log notification flood", async () => {
  let deliveredLogs = 0;
  let statusUpdates = 0;
  const runtime = createScriptRuntime({
    sessionId: "s1",
    runId: "r-log-flood",
    appendLog: () => { deliveredLogs += 1; },
    writeToSession: () => {},
    getOutputBuffer: () => ({ getText: () => "" }),
    getSessionMeta: () => ({ connected: true }),
    showDialog: async () => true,
    isPaused: () => false,
    isAborted: () => false,
    onStatusChange: () => { statusUpdates += 1; },
    syncExecutionTimeoutMs: 5_000,
  });

  const startedAt = Date.now();
  await assert.rejects(
    runtime.execute("for (let i = 0; i < 200000; i += 1) nct.log('x');"),
    new RegExp(`${SCRIPT_WORKER_MAX_LOG_NOTIFICATIONS} log notification limit`, "i"),
  );
  assert.ok(Date.now() - startedAt < 1_000);
  assert.equal(deliveredLogs, SCRIPT_WORKER_MAX_LOG_NOTIFICATIONS);
  assert.equal(statusUpdates, SCRIPT_WORKER_MAX_LOG_NOTIFICATIONS);
  assert.equal(_getActiveScriptWorkerCountForTests(), 0);
});

test("createScriptRuntime coalesces large progress floods before the total budget", async () => {
  let statusUpdates = 0;
  const runtime = createScriptRuntime({
    sessionId: "s1",
    runId: "r-progress-flood",
    appendLog: () => {},
    writeToSession: () => {},
    getOutputBuffer: () => ({ getText: () => "" }),
    getSessionMeta: () => ({ connected: true }),
    showDialog: async () => true,
    isPaused: () => false,
    isAborted: () => false,
    onStatusChange: () => { statusUpdates += 1; },
    syncExecutionTimeoutMs: 5_000,
  });

  await assert.rejects(
    runtime.execute(`
      nct.progress.start('many', 200000);
      for (let i = 0; i < 200000; i += 1) nct.progress.step('item ' + i);
    `),
    new RegExp(`${SCRIPT_WORKER_MAX_TOTAL_NOTIFICATIONS} notification limit`, "i"),
  );
  assert.ok(
    statusUpdates <= SCRIPT_WORKER_IMMEDIATE_PROGRESS_NOTIFICATIONS + 4,
    `progress broadcast count was not coalesced: ${statusUpdates}`,
  );
  assert.equal(_getActiveScriptWorkerCountForTests(), 0);
});

test("sensitive script input is masked in UI and logs and remains host-bypassed", async () => {
  const logs = [];
  const writes = [];
  const dialogs = [];
  const runtime = createScriptRuntime({
    sessionId: "s1",
    runId: "r-sensitive",
    appendLog: (_id, message) => logs.push(message),
    writeToSession: (sessionId, data, options) => writes.push({ sessionId, data, options }),
    getOutputBuffer: () => ({
      getText: () => "",
      consumeThroughAbsolute() {},
    }),
    getSessionMeta: () => ({ connected: true, hostname: "host", username: "user" }),
    showDialog: async (...args) => {
      dialogs.push(args);
      return "super-secret";
    },
    isPaused: () => false,
    isAborted: () => false,
    onStatusChange: () => {},
  });

  await runtime.execute(`
    const value = await nct.dialog.prompt("Secret", "", { sensitive: true });
    await nct.screen.sendLine(value, { sensitive: true });
  `);

  assert.deepEqual(dialogs[0], ["prompt", "Secret", "", { sensitive: true }]);
  assert.deepEqual(writes, [
    {
      sessionId: "s1",
      data: "super-secret",
      options: { automated: true, sensitive: true, invalidateStartupSeed: false },
    },
    {
      sessionId: "s1",
      data: "\r",
      options: { automated: true, sensitive: true, invalidateStartupSeed: false },
    },
  ]);
  assert.equal(logs.some((entry) => entry.includes("super-secret")), false);
  assert.equal(logs.some((entry) => entry.includes("[sensitive]")), true);
});

test("createScriptRuntime supports regex waits over multiline output", async () => {
  const logs = [];
  const buffer = new SessionOutputBuffer("s1");
  const runtime = createScriptRuntime({
    sessionId: "s1",
    runId: "r1",
    appendLog: (_id, message) => logs.push(message),
    writeToSession: () => {},
    getOutputBuffer: () => buffer,
    getSessionMeta: () => ({ connected: true, hostname: "host", username: "user" }),
    showDialog: async () => true,
    isPaused: () => false,
    isAborted: () => false,
    onStatusChange: () => {},
  });

  const run = runtime.execute(`
    await nct.screen.waitForRegex(".*SSH资源.*登录方式.*", 1000);
    nct.log("matched");
  `);
  buffer.append("1. SSH资源\n请选择SSH资源\n'zxadmin'登录方式:");

  await run;
  assert.deepEqual(logs, ["matched"]);
});

test("createScriptRuntime reports activity labels for loops without X/Y totals", async () => {
  const statuses = [];
  const runtime = createScriptRuntime({
    sessionId: "s1",
    runId: "r1",
    appendLog: () => {},
    writeToSession: () => {},
    getOutputBuffer: () => ({
      waitFor: async () => "ok",
      waitForAny: async () => 0,
      getText: () => "",
    }),
    getSessionMeta: () => ({ connected: true, hostname: "host", username: "user" }),
    showDialog: async () => true,
    isPaused: () => false,
    isAborted: () => false,
    onStatusChange: (_id, patch) => statuses.push(patch),
  });

  await runtime.execute("for (let i = 0; i < 3; i += 1) { nct.log(`step ${i}`); }");

  const last = statuses.at(-1);
  assert.equal(last.stepIndex, 3);
  assert.equal(last.activityLabel, "log");
  assert.equal(last.progressMode, "activity");
  assert.equal(last.totalSteps, undefined);
  assert.equal(last.currentStep, "log");
});

test("createScriptRuntime supports explicit determinate progress API", async () => {
  const statuses = [];
  const runtime = createScriptRuntime({
    sessionId: "s1",
    runId: "r1",
    appendLog: () => {},
    writeToSession: () => {},
    getOutputBuffer: () => ({
      waitFor: async () => "ok",
      waitForAny: async () => 0,
      getText: () => "",
    }),
    getSessionMeta: () => ({ connected: true, hostname: "host", username: "user" }),
    showDialog: async () => true,
    isPaused: () => false,
    isAborted: () => false,
    onStatusChange: (_id, patch) => statuses.push(patch),
  });

  await runtime.execute(`
    nct.progress.start('Sampling', 3);
    for (let i = 0; i < 3; i += 1) {
      nct.progress.step('item ' + i);
    }
    nct.progress.done();
    nct.log('finished');
  `);

  const during = statuses.find((patch) => patch.progressMode === "determinate" && patch.progressCurrent === 2);
  assert.ok(during);
  assert.equal(during.progressLabel, "Sampling");
  assert.equal(during.progressTotal, 3);
  assert.equal(during.activityLabel, "item 1");

  const afterDone = statuses.filter((patch) => patch.progressMode === "activity").at(-1);
  assert.ok(afterDone);
  assert.equal(afterDone.progressCurrent, undefined);
  assert.equal(afterDone.progressTotal, undefined);
});

test("normalizeDialogFormSpec normalizes fields and default choice values", () => {
  const form = normalizeDialogFormSpec({
    title: "Deploy",
    message: "Choose options",
    fields: [
      {
        type: "select",
        name: "env",
        label: "Environment",
        options: [
          { label: "Prod", value: "prod", disabled: true },
          "dev",
        ],
        defaultValue: "prod",
      },
      {
        type: "checkbox",
        name: "restart",
        label: "Restart",
        defaultValue: 1,
      },
      {
        type: "radio",
        name: "mode",
        label: "Mode",
        options: [{ label: "Safe", value: "safe", description: "Recommended" }],
      },
      {
        type: "textarea",
        name: "notes",
        label: "Notes",
        defaultValue: 123,
        required: false,
      },
      {
        type: "number",
        name: "retries",
        label: "Retries",
        defaultValue: "3",
        min: "0",
        step: "1",
        visibleWhen: { field: "restart", equals: true },
      },
    ],
  });

  assert.equal(form.title, "Deploy");
  assert.equal(form.message, "Choose options");
  assert.equal(form.fields[0].defaultValue, "dev");
  assert.deepEqual(form.fields[0].options[1], {
    label: "dev",
    value: "dev",
    description: undefined,
    disabled: false,
  });
  assert.equal(form.fields[1].defaultValue, true);
  assert.equal(form.fields[1].required, false);
  assert.equal(form.fields[2].defaultValue, "safe");
  assert.equal(form.fields[3].defaultValue, "123");
  assert.equal(form.fields[3].required, false);
  assert.equal(form.fields[4].defaultValue, 3);
  assert.equal(form.fields[4].min, 0);
  assert.equal(form.fields[4].step, 1);
  assert.deepEqual(form.fields[4].visibleWhen, { field: "restart", equals: true });
});

test("normalizeDialogFormSpec rejects invalid fields", () => {
  assert.throws(
    () => normalizeDialogFormSpec({ fields: [{ type: "checkbox", name: "", label: "Missing name" }] }),
    /field name is required/,
  );
  assert.throws(
    () => normalizeDialogFormSpec({
      fields: [
        { type: "checkbox", name: "same", label: "One" },
        { type: "checkbox", name: "same", label: "Two" },
      ],
    }),
    /Duplicate dialog form field name: same/,
  );
  assert.throws(
    () => normalizeDialogFormSpec({ fields: [{ type: "checkbox", name: "__proto__", label: "Reserved" }] }),
    /field name is reserved: __proto__/,
  );
  assert.throws(
    () => normalizeDialogFormSpec({ fields: [{ type: "select", name: "env", label: "Env", options: [] }] }),
    /requires at least one option/,
  );
  assert.throws(
    () => normalizeDialogFormSpec({ fields: [{ type: "select", name: "env", label: "Env", options: [""] }] }),
    /option value is required/,
  );
  assert.throws(
    () => normalizeDialogFormSpec({ fields: [{ type: "select", name: "env", label: "Env", options: ["dev", { label: "Dev again", value: "dev" }] }] }),
    /option values must be unique: dev/,
  );
  assert.throws(
    () => normalizeDialogFormSpec({
      fields: [{
        type: "radio",
        name: "mode",
        label: "Mode",
        options: [{ label: "Safe", value: "safe", disabled: true }],
      }],
    }),
    /requires at least one enabled option/,
  );
  assert.throws(
    () => normalizeDialogFormSpec({
      fields: [{ type: "number", name: "count", label: "Count", defaultValue: "many" }],
    }),
    /defaultValue must be a finite number/,
  );
  assert.throws(
    () => normalizeDialogFormSpec({
      fields: [{ type: "number", name: "count", label: "Count", min: 10, max: 1 }],
    }),
    /min cannot be greater than max/,
  );
  assert.throws(
    () => normalizeDialogFormSpec({
      fields: [
        { type: "select", name: "target", label: "Target", options: ["local", "remote"] },
        { type: "textarea", name: "host", label: "Host", visibleWhen: { field: "missing", equals: "remote" } },
      ],
    }),
    /visibleWhen references unknown field: missing/,
  );
  assert.throws(
    () => normalizeDialogFormSpec({
      fields: [
        { type: "select", name: "target", label: "Target", options: ["local", "remote"] },
        { type: "textarea", name: "host", label: "Host", visibleWhen: { field: "target", equals: "remote", truthy: true } },
      ],
    }),
    /requires exactly one condition operator/,
  );
  assert.throws(
    () => normalizeDialogFormSpec({
      fields: [
        { type: "textarea", name: "host", label: "Host", visibleWhen: { field: "target", equals: "remote" } },
        { type: "select", name: "target", label: "Target", options: ["local", "remote"] },
      ],
    }),
    /visibleWhen must reference an earlier field: host/,
  );
  assert.throws(
    () => normalizeDialogFormSpec({
      fields: [{ type: "checkbox", name: "self", label: "Self", visibleWhen: { field: "self", truthy: true } }],
    }),
    /visibleWhen must reference an earlier field: self/,
  );
  assert.throws(
    () => normalizeDialogFormSpec({
      fields: [{ type: "number", name: "count", label: "Count", defaultValue: -1, min: 0 }],
    }),
    /defaultValue cannot be less than min/,
  );
  assert.throws(
    () => normalizeDialogFormSpec({
      fields: [{ type: "number", name: "count", label: "Count", defaultValue: 6, min: 1, step: 2 }],
    }),
    /defaultValue must match step from min/,
  );
});

test("createScriptRuntime exposes form dialog API through showDialog", async () => {
  let dialogCall;
  const runtime = createScriptRuntime({
    sessionId: "s1",
    runId: "r1",
    appendLog: () => {},
    writeToSession: () => {},
    getOutputBuffer: () => ({
      waitFor: async () => "ok",
      waitForAny: async () => 0,
      getText: () => "",
    }),
    getSessionMeta: () => ({ connected: true, hostname: "host", username: "user" }),
    showDialog: async (type, message, defaultValue, extras) => {
      dialogCall = { type, message, defaultValue, extras };
      return { env: "prod", restart: true };
    },
    isPaused: () => false,
    isAborted: () => false,
    onStatusChange: () => {},
  });

  await runtime.execute(`
    const values = await nct.dialog.form({
      message: 'Deploy?',
      fields: [
        { type: 'select', name: 'env', label: 'Environment', options: ['dev', 'prod'], defaultValue: 'prod' },
        { type: 'checkbox', name: 'restart', label: 'Restart', defaultValue: false },
      ],
    });
    nct.log(values.env + ':' + values.restart);
  `);

  assert.equal(dialogCall.type, "form");
  assert.equal(dialogCall.message, "Deploy?");
  assert.equal(dialogCall.defaultValue, undefined);
  assert.equal(dialogCall.extras.form.fields[0].defaultValue, "prod");
});

test("createScriptRuntime convenience dialog controls return single values", async () => {
  const results = [
    { value: "prod" },
    { value: "safe" },
    { value: true },
  ];
  const calls = [];
  const runtime = createScriptRuntime({
    sessionId: "s1",
    runId: "r1",
    appendLog: () => {},
    writeToSession: () => {},
    getOutputBuffer: () => ({
      waitFor: async () => "ok",
      waitForAny: async () => 0,
      getText: () => "",
    }),
    getSessionMeta: () => ({ connected: true, hostname: "host", username: "user" }),
    showDialog: async (type, message, _defaultValue, extras) => {
      calls.push({ type, message, fieldType: extras.form.fields[0].type });
      return results.shift();
    },
    isPaused: () => false,
    isAborted: () => false,
    onStatusChange: () => {},
  });

  const values = [];
  runtime.nct.log = (message) => values.push(message);
  await runtime.execute(`
    nct.log(await nct.dialog.select('Environment', ['dev', 'prod'], 'dev'));
    nct.log(await nct.dialog.radio('Mode', ['safe', 'fast'], 'safe'));
    nct.log(String(await nct.dialog.checkbox('Restart', true)));
  `);

  assert.deepEqual(calls.map((call) => call.fieldType), ["select", "radio", "checkbox"]);
  assert.deepEqual(values, ["prod", "safe", "true"]);
});

test("createScriptRuntime does not open dialogs after a script is stopped", async () => {
  let aborted = false;
  let dialogCalls = 0;
  const runtime = createScriptRuntime({
    sessionId: "s1",
    runId: "r1",
    appendLog: () => {},
    writeToSession: () => {},
    getOutputBuffer: () => ({
      waitFor: async () => "ok",
      waitForAny: async () => 0,
      getText: () => "",
    }),
    getSessionMeta: () => ({ connected: true, hostname: "host", username: "user" }),
    showDialog: async () => {
      dialogCalls += 1;
      return true;
    },
    isPaused: () => false,
    isAborted: () => aborted,
    onStatusChange: () => {},
  });

  const run = runtime.execute(`
    try {
      await nct.sleep(5000);
    } catch {
      await nct.dialog.confirm('still there?');
    }
  `);
  setTimeout(() => {
    aborted = true;
  }, 30);

  await assert.rejects(run, /Script stopped/);
  assert.equal(dialogCalls, 0);
});
