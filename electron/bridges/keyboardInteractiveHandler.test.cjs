const test = require("node:test");
const assert = require("node:assert/strict");

const keyboardInteractiveHandler = require("./keyboardInteractiveHandler.cjs");

test("keyboard-interactive responses from the wrong renderer are rejected and kept pending", () => {
  const finishCalls = [];
  const requestId = keyboardInteractiveHandler.generateRequestId("test");
  keyboardInteractiveHandler.storeRequest(requestId, (responses) => {
    finishCalls.push(responses);
  }, 101, "session-1");

  const wrongResult = keyboardInteractiveHandler.handleResponse(
    { sender: { id: 202 } },
    { requestId, responses: ["wrong"] },
  );
  assert.deepEqual(wrongResult, { success: false, error: "Wrong sender" });
  assert.deepEqual(finishCalls, []);
  assert.equal(keyboardInteractiveHandler.getRequests().has(requestId), true);

  const correctResult = keyboardInteractiveHandler.handleResponse(
    { sender: { id: 101 } },
    { requestId, responses: ["correct"] },
  );
  assert.deepEqual(correctResult, { success: true });
  assert.deepEqual(finishCalls, [["correct"]]);
  assert.equal(keyboardInteractiveHandler.getRequests().has(requestId), false);
});

test("keyboard-interactive responses never write password or OTP contents to logs", (t) => {
  const logs = [];
  t.mock.method(console, "log", (...args) => logs.push(args));
  const finishCalls = [];
  const requestId = keyboardInteractiveHandler.generateRequestId("secret-log-test");
  const secrets = ["secondary-password-secret", "123456-otp-secret"];

  keyboardInteractiveHandler.storeRequest(requestId, (responses) => {
    finishCalls.push(responses);
  }, 303, "session-secret-log-test");

  const result = keyboardInteractiveHandler.handleResponse(
    { sender: { id: 303 } },
    { requestId, responses: secrets, cancelled: false },
  );

  assert.deepEqual(result, { success: true });
  assert.deepEqual(finishCalls, [secrets]);
  const serializedLogs = JSON.stringify(logs);
  for (const secret of secrets) {
    assert.equal(serializedLogs.includes(secret), false);
  }
  assert.equal(
    logs.some((entry) => entry.some((value) => value?.responsesCount === secrets.length)),
    true,
  );
});

test("keyboard-interactive delivery failures close the renderer prompt", (t) => {
  t.mock.method(console, "warn", () => {});
  const notifications = [];
  const requestId = keyboardInteractiveHandler.generateRequestId("delivery-failure");
  keyboardInteractiveHandler.storeRequest(
    requestId,
    () => {
      throw new Error("connection closed");
    },
    404,
    "session-delivery-failure",
    {
      isDestroyed: () => false,
      send: (channel, payload) => notifications.push({ channel, payload }),
    },
  );

  const result = keyboardInteractiveHandler.handleResponse(
    { sender: { id: 404 } },
    { requestId, responses: ["123456"], cancelled: false },
  );

  assert.deepEqual(result, { success: false, error: "Failed to deliver response" });
  assert.equal(keyboardInteractiveHandler.getRequests().has(requestId), false);
  assert.deepEqual(notifications, [{
    channel: "netcatty:keyboard-interactive-cancelled",
    payload: {
      requestId,
      sessionId: "session-delivery-failure",
      reason: "delivery-failed",
    },
  }]);
});

test("keyboard-interactive responses settle once when delivery closes the session", () => {
  const finishCalls = [];
  const requestId = keyboardInteractiveHandler.generateRequestId("reentrant-close");
  keyboardInteractiveHandler.storeRequest(
    requestId,
    (responses) => {
      finishCalls.push(responses);
      keyboardInteractiveHandler.cancelRequestsForSession("session-reentrant-close");
    },
    505,
    "session-reentrant-close",
  );

  const result = keyboardInteractiveHandler.handleResponse(
    { sender: { id: 505 } },
    { requestId, responses: ["123456"], cancelled: false },
  );

  assert.deepEqual(result, { success: true });
  assert.deepEqual(finishCalls, [["123456"]]);
  assert.equal(keyboardInteractiveHandler.getRequests().has(requestId), false);
});

test("keyboard-interactive requests can be cancelled by owning session", () => {
  const finishCalls = [];
  const notifications = [];
  const matchingRequestId = keyboardInteractiveHandler.generateRequestId("matching");
  const otherRequestId = keyboardInteractiveHandler.generateRequestId("other");
  keyboardInteractiveHandler.storeRequest(
    matchingRequestId,
    (responses) => finishCalls.push({ requestId: matchingRequestId, responses }),
    101,
    "tunnel-1",
    {
      isDestroyed: () => false,
      send: (channel, payload) => notifications.push({ channel, payload }),
    },
  );
  keyboardInteractiveHandler.storeRequest(
    otherRequestId,
    (responses) => finishCalls.push({ requestId: otherRequestId, responses }),
    101,
    "tunnel-2",
  );

  const cancelled = keyboardInteractiveHandler.cancelRequestsForSession("tunnel-1", "tunnel-stopped");

  assert.equal(cancelled, 1);
  assert.deepEqual(finishCalls, [{ requestId: matchingRequestId, responses: [] }]);
  assert.deepEqual(notifications, [{
    channel: "netcatty:keyboard-interactive-cancelled",
    payload: {
      requestId: matchingRequestId,
      sessionId: "tunnel-1",
      reason: "tunnel-stopped",
    },
  }]);
  assert.equal(keyboardInteractiveHandler.getRequests().has(matchingRequestId), false);
  assert.equal(keyboardInteractiveHandler.getRequests().has(otherRequestId), true);

  keyboardInteractiveHandler.cancelRequestsForSession("tunnel-2");
});
