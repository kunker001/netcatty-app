const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildPortForwardEndpoint,
  buildPortForwardEndpointFromStartPayload,
} = require("./portForwardingBridge.cjs");
const {
  buildConnectionReuseEndpoint,
  buildEndpointKey,
  normalizeEndpoint,
} = require("./sshConnectionPool.cjs");

const baseOptions = {
  hostId: "pf-profile",
  hostname: "pf-endpoint.test",
  port: 22,
  username: "alice",
  authMethod: "key",
  keyId: "pf-key",
  privateKey: "PF_PRIVATE_SECRET",
  publicKey: "ssh-ed25519 PF_PUBLIC_KEY",
  passphrase: "PF_PASSPHRASE_SECRET",
  identityFilePaths: ["/keys/pf"],
  useSshAgent: true,
  identityAgent: "/run/user/1000/pf-agent-a.sock",
  identitiesOnly: true,
  agentPublicKeys: ["ssh-ed25519 PF_AGENT_KEY_A"],
  addKeysToAgent: "confirm",
  useKeychain: true,
  legacyAlgorithms: false,
  skipEcdsaHostKey: false,
  algorithmOverrides: { kex: ["curve25519-sha256"] },
  verifyHostKeys: true,
  knownHosts: [{
    id: "kh-pf-endpoint",
    hostname: "pf-endpoint.test",
    port: 22,
    keyType: "ssh-ed25519",
    fingerprint: "SHA256:pf-endpoint-a",
    publicKey: "ssh-ed25519 PF_KNOWN_HOST_KEY_A",
  }],
};

function endpointKey(options = baseOptions) {
  return buildEndpointKey(buildPortForwardEndpoint(options));
}

test("port-forward endpoint identity changes for every effective agent selection setting", () => {
  const baseKey = endpointKey();
  const variants = [
    { identityAgent: "/run/user/1000/pf-agent-b.sock" },
    { identitiesOnly: false },
    { agentPublicKeys: ["ssh-ed25519 PF_AGENT_KEY_B"] },
    { addKeysToAgent: "yes" },
    { useKeychain: false },
  ];

  for (const variant of variants) {
    assert.notEqual(endpointKey({ ...baseOptions, ...variant }), baseKey);
  }
});

test("port-forward endpoint identity changes for every effective algorithm setting", () => {
  const baseKey = endpointKey();
  const variants = [
    { legacyAlgorithms: true },
    { skipEcdsaHostKey: true },
    { algorithmOverrides: { kex: ["diffie-hellman-group14-sha256"] } },
  ];

  for (const variant of variants) {
    assert.notEqual(endpointKey({ ...baseOptions, ...variant }), baseKey);
  }
});

test("port-forward endpoint identity includes the effective known-host trust set", () => {
  const baseKey = endpointKey();
  const rotatedKnownHosts = [{
    ...baseOptions.knownHosts[0],
    fingerprint: "SHA256:pf-endpoint-b",
    publicKey: "ssh-ed25519 PF_KNOWN_HOST_KEY_B",
  }];

  assert.notEqual(endpointKey({ ...baseOptions, knownHosts: rotatedKnownHosts }), baseKey);
  assert.equal(
    endpointKey(),
    buildEndpointKey(buildConnectionReuseEndpoint(baseOptions, { sftpSudo: false })),
  );
});

test("port-forward endpoint normalizes to the common digest-only connection identity", () => {
  const normalized = normalizeEndpoint(buildPortForwardEndpoint(baseOptions));
  const serialized = JSON.stringify(normalized);

  assert.ok(normalized?.authFingerprint);
  for (const secret of [
    baseOptions.privateKey,
    baseOptions.passphrase,
    baseOptions.agentPublicKeys[0],
    baseOptions.knownHosts[0].publicKey,
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("port-forward start identity uses the resolved keepalive policy", () => {
  const payload = {
    ...baseOptions,
    resolvedKeepaliveInterval: 30,
    resolvedKeepaliveCountMax: 10,
  };
  assert.equal(
    buildEndpointKey(buildPortForwardEndpointFromStartPayload(payload)),
    buildEndpointKey(buildConnectionReuseEndpoint({
      ...baseOptions,
      keepaliveInterval: 30,
      keepaliveCountMax: 10,
    })),
  );
});
