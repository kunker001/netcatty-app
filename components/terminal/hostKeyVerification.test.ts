import test from "node:test";
import assert from "node:assert/strict";

import { createKnownHostFromHostKeyInfo, toHostKeyInfo } from "./hostKeyVerification";

test("host key verification keeps the existing known host id when saving", () => {
  const hostKeyInfo = toHostKeyInfo({
    hostname: "switch.local",
    port: 22,
    keyType: "unknown",
    fingerprint: "new-fingerprint",
    status: "changed",
    knownHostId: "kh-existing",
    knownFingerprint: "old-fingerprint",
  });

  const knownHost = createKnownHostFromHostKeyInfo(
    hostKeyInfo,
    { port: 2200 },
    200,
    "generated",
  );

  assert.equal(hostKeyInfo.knownHostId, "kh-existing");
  assert.deepEqual(knownHost, {
    id: "kh-existing",
    hostname: "switch.local",
    port: 22,
    keyType: "unknown",
    publicKey: "SHA256:new-fingerprint",
    fingerprint: "new-fingerprint",
    discoveredAt: 200,
  });
});
