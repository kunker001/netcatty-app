import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("server stats retry can restart polling after give-up", () => {
  const source = readFileSync(new URL("../../application/state/useServerStats.ts", import.meta.url), "utf8");
  const reconcileStart = source.indexOf("function reconcileSharedServerStatsSession");
  const shouldRestartCheck = source.indexOf("const shouldRestartPolling", reconcileStart);
  const givenUpCheck = source.indexOf("if (session.givenUp) return;", shouldRestartCheck);
  const markPollingActive = source.indexOf("session.pollingActive = true", shouldRestartCheck);

  assert.notEqual(reconcileStart, -1);
  assert.notEqual(shouldRestartCheck, -1);
  assert.notEqual(givenUpCheck, -1);
  assert.notEqual(markPollingActive, -1);
  assert.ok(givenUpCheck < markPollingActive);
});

test("server stats stale requests do not block a fresh visible fetch", () => {
  const source = readFileSync(new URL("../../application/state/useServerStats.ts", import.meta.url), "utf8");

  assert.match(source, /inflightGeneration: number \| null/);
  assert.match(source, /session\.inflight && session\.inflightGeneration === session\.fetchGeneration/);
  assert.match(source, /session\.inflightGeneration = generation/);
});

test("server stats polling does not stop when its terminal is in the background", () => {
  const source = readFileSync(new URL("../../application/state/useServerStats.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /isVisible/);
  assert.doesNotMatch(source, /getVisibleServerStatsClients/);
  assert.doesNotMatch(source, /resuming from hidden/);
});

test("server stats keep last snapshot when all consumers pause", () => {
  const source = readFileSync(new URL("../../application/state/useServerStats.ts", import.meta.url), "utf8");
  const reconcileStart = source.indexOf("function reconcileSharedServerStatsSession");
  const idleBranch = source.indexOf("if (activeClients.length === 0)", reconcileStart);
  const nextFunction = source.indexOf("\nfunction ", reconcileStart + 1);
  const idleBody = source.slice(idleBranch, nextFunction === -1 ? undefined : nextFunction);

  assert.notEqual(reconcileStart, -1);
  assert.notEqual(idleBranch, -1);
  // Pausing must not wipe lastUpdated stats (Overview tab-switch empty flash).
  assert.match(idleBody, /clearServerStatsTimers\(session\)/);
  assert.doesNotMatch(idleBody, /resetServerStatsSession\(session\)/);
  assert.doesNotMatch(idleBody, /createInitialState/);
  // But give-up must clear so resume can auto-retry after hard failure.
  assert.match(idleBody, /session\.givenUp = false/);
  assert.match(idleBody, /session\.consecutiveFailures = 0/);
});
