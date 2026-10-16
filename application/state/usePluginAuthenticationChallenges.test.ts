import assert from "node:assert/strict";
import test from "node:test";
import {
  handlePluginAuthenticationChallengeEvent,
  pluginAuthenticationResponseErrorMessage,
} from "./usePluginAuthenticationChallenges";

test("plugin authentication response errors are bounded before display", () => {
  assert.equal(pluginAuthenticationResponseErrorMessage(new Error("bridge down")), "bridge down");
  assert.equal(pluginAuthenticationResponseErrorMessage("  failed  "), "failed");
  assert.equal(pluginAuthenticationResponseErrorMessage({}), "");
  assert.equal(pluginAuthenticationResponseErrorMessage(new Error("x".repeat(600))).length, 512);
});

test("plugin authentication queue overflow sends one cancellation outside the state updater", () => {
  const queue = Array.from({ length: 32 }, (_, index) => ({
    requestId: `request-${index}`,
    challengeRequestId: `challenge-request-${index}`,
    challenge: {
      id: `challenge-${index}`,
      kind: "text" as const,
      title: `Challenge ${index}`,
    },
  }));
  const queueRef = { current: queue };
  let stateUpdateCount = 0;
  let responseCount = 0;

  handlePluginAuthenticationChallengeEvent(
    queueRef,
    (next) => {
      assert.ok(Array.isArray(next), "queue updates must use a value, not a replayable updater");
      stateUpdateCount += 1;
    },
    {
      requestId: "overflow-request",
      challengeRequestId: "overflow-challenge-request",
      challenge: { id: "overflow-challenge", kind: "password", title: "Password" },
    },
    async () => {
      responseCount += 1;
    },
  );

  assert.equal(responseCount, 1);
  assert.equal(stateUpdateCount, 0);
  assert.equal(queueRef.current, queue);
});
