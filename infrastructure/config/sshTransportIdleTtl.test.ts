import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SSH_TRANSPORT_IDLE_TTL_MS,
  resolveSshTransportIdleTtlMs,
} from "./sshTransportIdleTtl.ts";

test("ssh transport idle TTL defaults to 5 minutes", () => {
  assert.equal(DEFAULT_SSH_TRANSPORT_IDLE_TTL_MS, 5 * 60_000);
  assert.equal(resolveSshTransportIdleTtlMs(() => null), DEFAULT_SSH_TRANSPORT_IDLE_TTL_MS);
});

test("ssh transport idle TTL accepts presets including never-reclaim", () => {
  assert.equal(resolveSshTransportIdleTtlMs(() => 60_000), 60_000);
  assert.equal(resolveSshTransportIdleTtlMs(() => 0), 0);
  assert.equal(resolveSshTransportIdleTtlMs(() => 123), DEFAULT_SSH_TRANSPORT_IDLE_TTL_MS);
});
