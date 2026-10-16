import test from "node:test";
import assert from "node:assert/strict";

import { detectSuspiciousShrink } from "./syncGuards.ts";
import type { SyncPayload } from "./sync.ts";

function payload(overrides: Partial<SyncPayload> = {}): SyncPayload {
  return {
    hosts: [],
    keys: [],
    identities: [],
    snippets: [],
    customGroups: [],
    snippetPackages: [],
    knownHosts: [],
    portForwardingRules: [],
    groupConfigs: [],
    settings: undefined,
    syncedAt: 0,
    ...overrides,
  };
}

function hosts(n: number): SyncPayload["hosts"] {
  return Array.from({ length: n }, (_, i) => ({
    id: `h${i}`,
    label: `h${i}`,
    hostname: `h${i}.example`,
    port: 22,
    username: "root",
    protocol: "ssh",
  })) as SyncPayload["hosts"];
}

test("null base, no remote fallback → not suspicious (nothing to compare)", () => {
  const result = detectSuspiciousShrink(payload({ hosts: hosts(1) }), null);
  assert.deepEqual(result, { suspicious: false });
});

test("null base + empty remote → not suspicious (genuinely empty cloud)", () => {
  const result = detectSuspiciousShrink(payload({ hosts: hosts(5) }), null, payload());
  assert.deepEqual(result, { suspicious: false });
});

test("null base + populated remote + empty outgoing → suspicious via remote (#779 scenario)", () => {
  // Fresh install with no stored base; remote already holds user's keychain.
  // Local payload is empty (degraded vault / load race) → must be blocked.
  const remote = payload({ keys: Array.from({ length: 8 }, (_, i) => ({ id: `k${i}`, label: `k${i}`, privateKey: "x" })) as SyncPayload["keys"] });
  const out = payload();
  const result = detectSuspiciousShrink(out, null, remote);
  assert.equal(result.suspicious, true);
  if (result.suspicious) {
    assert.equal(result.entityType, "keys");
    assert.equal(result.viaRemote, true);
    assert.equal(result.lost, 8);
  }
});

test("null base + larger remote + outgoing growth → not suspicious (lost is negative)", () => {
  const remote = payload({ hosts: hosts(3) });
  const out = payload({ hosts: hosts(10) });
  assert.deepEqual(detectSuspiciousShrink(out, null, remote), { suspicious: false });
});

test("base present takes precedence over remote fallback", () => {
  // base=10, outgoing=10 → not suspicious; remote=0 should NOT trigger a
  // via-remote warning because a real base is available.
  const base = payload({ hosts: hosts(10) });
  const remote = payload();
  const out = payload({ hosts: hosts(10) });
  assert.deepEqual(detectSuspiciousShrink(out, base, remote), { suspicious: false });
});

test("no shrink — same counts → not suspicious", () => {
  const base = payload({ hosts: hosts(5) });
  const out = payload({ hosts: hosts(5) });
  assert.deepEqual(detectSuspiciousShrink(out, base), { suspicious: false });
});

test("growth only → not suspicious", () => {
  const base = payload({ hosts: hosts(5) });
  const out = payload({ hosts: hosts(10) });
  assert.deepEqual(detectSuspiciousShrink(out, base), { suspicious: false });
});

test("shrink under both thresholds → not suspicious (delete 2 of 4)", () => {
  const base = payload({ hosts: hosts(4) });
  const out = payload({ hosts: hosts(2) });
  assert.deepEqual(detectSuspiciousShrink(out, base), { suspicious: false });
});

test("bulk-shrink 50% AND absolute 3 — exactly at threshold → suspicious", () => {
  const base = payload({ hosts: hosts(6) });
  const out = payload({ hosts: hosts(3) });
  assert.deepEqual(detectSuspiciousShrink(out, base), {
    suspicious: true,
    reason: "bulk-shrink",
    entityType: "hosts",
    baseCount: 6,
    outgoingCount: 3,
    lost: 3,
  });
});

test("bulk-shrink 50% but absolute 2 → not suspicious (absolute gate)", () => {
  const base = payload({ hosts: hosts(4) });
  const out = payload({ hosts: hosts(2) });
  assert.deepEqual(detectSuspiciousShrink(out, base), { suspicious: false });
});

test("bulk-shrink 40% absolute 4 → not suspicious (ratio gate)", () => {
  const base = payload({ hosts: hosts(10) });
  const out = payload({ hosts: hosts(6) });
  assert.deepEqual(detectSuspiciousShrink(out, base), { suspicious: false });
});

test("large-shrink absolute 10 regardless of ratio → suspicious", () => {
  const base = payload({ hosts: hosts(100) });
  const out = payload({ hosts: hosts(90) });
  assert.deepEqual(detectSuspiciousShrink(out, base), {
    suspicious: true,
    reason: "large-shrink",
    entityType: "hosts",
    baseCount: 100,
    outgoingCount: 90,
    lost: 10,
  });
});

test("dual-trigger (large-shrink AND bulk-shrink both satisfied) → reason is 'large-shrink'", () => {
  // base=20, lost=10: satisfies large-shrink (>=10) AND bulk-shrink (50%, >=3)
  const base = payload({ hosts: hosts(20) });
  const out = payload({ hosts: hosts(10) });
  const result = detectSuspiciousShrink(out, base);
  assert.equal(result.suspicious, true);
  if (result.suspicious) assert.equal(result.reason, "large-shrink");
});

test("multiple entity types shrinking — returns first in declaration order (hosts before keys)", () => {
  const base = payload({ hosts: hosts(6), keys: Array.from({ length: 6 }, (_, i) => ({ id: `k${i}`, label: `k${i}`, privateKey: "x" })) as SyncPayload["keys"] });
  const out = payload({ hosts: hosts(3), keys: Array.from({ length: 3 }, (_, i) => ({ id: `k${i}`, label: `k${i}`, privateKey: "x" })) as SyncPayload["keys"] });
  const result = detectSuspiciousShrink(out, base);
  assert.equal(result.suspicious, true);
  if (result.suspicious) assert.equal(result.entityType, "hosts");
});

test("only non-hosts entity shrinks → reports that entity", () => {
  const snippets = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, label: `s${i}`, command: "" })) as SyncPayload["snippets"];
  const base = payload({ snippets: snippets(10) });
  const out = payload({ snippets: snippets(0) });
  const result = detectSuspiciousShrink(out, base);
  assert.equal(result.suspicious, true);
  if (result.suspicious) {
    assert.equal(result.entityType, "snippets");
    assert.equal(result.reason, "large-shrink");
  }
});

test("proxy profile shrink is protected like other synced vault entities", () => {
  const proxyProfiles = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `proxy-${i}`,
      label: `Proxy ${i}`,
      config: { type: "http", host: `proxy-${i}.example.com`, port: 3128 },
      createdAt: i,
    }));

  const base = payload({ proxyProfiles: proxyProfiles(10) } as Partial<SyncPayload>);
  const out = payload({ proxyProfiles: [] } as Partial<SyncPayload>);
  const result = detectSuspiciousShrink(out, base);

  assert.equal(result.suspicious, true);
  if (result.suspicious) {
    assert.equal(result.entityType, "proxyProfiles");
    assert.equal(result.reason, "large-shrink");
  }
});

test("wiping group configs while other vault data remains is suspicious (#2757)", () => {
  // Group defaults often hold startup commands / host appearance for a small
  // number of folders. A hydration race that uploads hosts + groupConfigs:[]
  // must not clear the cloud copy just because lost < BULK_SHRINK_MIN_ABSOLUTE.
  const base = payload({
    hosts: hosts(1),
    groupConfigs: [
      {
        path: "prod",
        startupCommand: "tmux attach || tmux",
        theme: "solarized-dark",
        themeOverride: true,
      },
    ],
  } as Partial<SyncPayload>);
  const out = payload({ hosts: hosts(1), groupConfigs: [] });
  const result = detectSuspiciousShrink(out, base);
  assert.equal(result.suspicious, true);
  if (result.suspicious) {
    assert.equal(result.entityType, "groupConfigs");
    assert.equal(result.lost, 1);
    assert.equal(result.reason, "bulk-shrink");
  }
});

test("wiping the last snippet while hosts remain is still a normal delete", () => {
  // The groupConfigs complete-wipe guard must not broaden to every entity —
  // deleting your only snippet with hosts present is intentional.
  const snippets = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `s${i}`, label: `s${i}`, command: "" })) as SyncPayload["snippets"];
  const base = payload({ hosts: hosts(1), snippets: snippets(1) });
  const out = payload({ hosts: hosts(1), snippets: snippets(0) });
  assert.deepEqual(detectSuspiciousShrink(out, base), { suspicious: false });
});

test("a fully empty outgoing snapshot is not a partial wipe (#2757)", () => {
  // Empty-everything against a trusted baseline is a real deletion path
  // (convergent migration). Do not flag complete wipes when no other vault
  // content remains on the outgoing payload.
  const base = payload({
    hosts: hosts(1),
    groupConfigs: [{ path: "prod", startupCommand: "echo hi" }],
  } as Partial<SyncPayload>);
  const out = payload();
  assert.deepEqual(detectSuspiciousShrink(out, base), { suspicious: false });
});

test("knownHosts shrink is ignored because known hosts are local-only", () => {
  const kh = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `kh${i}`, hostname: `h${i}`, port: 22, keyType: "rsa", fingerprint: "x" })) as unknown as SyncPayload["knownHosts"];
  const base = payload({ knownHosts: kh(12) });
  const out = payload({ knownHosts: kh(2) });
  assert.deepEqual(detectSuspiciousShrink(out, base), { suspicious: false });
});

test("empty base (all zeros) — no shrink possible, returns not suspicious", () => {
  const base = payload();
  const out = payload({ hosts: hosts(5) });
  // All base counts are 0; no shrink possible
  assert.deepEqual(detectSuspiciousShrink(out, base), { suspicious: false });
});
