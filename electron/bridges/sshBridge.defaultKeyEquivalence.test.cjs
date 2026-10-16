"use strict";

// Characterization test pinning the property that `startSession.cjs` relies on
// after the connection-startup optimization: the single preferred default key
// equals `findAllDefaultPrivateKeys()[0]`, so the connect path can derive it
// from the (already-needed) full list instead of scanning ~/.ssh a second time.
//
// These are the *local* sshBridge functions actually wired into startSession via
// `with(ctx)` (sshBridge.cjs passes its own findDefaultPrivateKey /
// findAllDefaultPrivateKeys into createStartSessionApi), exposed here as
// `_findDefaultPrivateKey` / `_findAllDefaultPrivateKeys`. Testing the helper's
// copy would prove nothing about the path the change runs on.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  _findDefaultPrivateKey: findDefaultPrivateKey,
  _findAllDefaultPrivateKeys: findAllDefaultPrivateKeys,
} = require("./sshBridge.cjs");

const UNENCRYPTED = (tag) =>
  `-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK${tag}fakebody\n-----END RSA PRIVATE KEY-----\n`;
const ENCRYPTED =
  "-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIBfake\n-----END ENCRYPTED PRIVATE KEY-----\n";

async function withFakeSshDir(files, run) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-default-key-"));
  const sshDir = path.join(home, ".ssh");
  fs.mkdirSync(sshDir);
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(sshDir, name), content);
  }
  const originalHomedir = os.homedir;
  os.homedir = () => home;
  try {
    return await run();
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// The refactor replaces `await findDefaultPrivateKey()` with `allDefaultKeys[0] ?? null`.
async function assertEquivalent() {
  const single = await findDefaultPrivateKey();
  const all = await findAllDefaultPrivateKeys();
  assert.deepStrictEqual(single, all[0] ?? null);
  return { single, all };
}

test("default key equals first of all default keys with mixed key files", async () => {
  await withFakeSshDir(
    {
      id_ed25519: UNENCRYPTED("ed"),
      id_ecdsa: ENCRYPTED, // preferred but encrypted -> skipped by both
      id_rsa: UNENCRYPTED("rsa"),
      id_custom: UNENCRYPTED("custom"),
      id_notakey: "this is not a private key",
      config: "Host *\n", // does not match id_* pattern -> ignored
    },
    async () => {
      const { single, all } = await assertEquivalent();
      // Preferred unencrypted key wins.
      assert.strictEqual(single.keyName, "id_ed25519");
      // Encrypted + non-key files are excluded from the full list.
      assert.deepStrictEqual(
        all.map((k) => k.keyName),
        ["id_ed25519", "id_rsa", "id_custom"],
      );
      // Returned shape is what the auth fallback consumes.
      assert.deepStrictEqual(Object.keys(single).sort(), [
        "keyName",
        "keyPath",
        "privateKey",
      ]);
    },
  );
});

test("both resolve to null/empty when only encrypted keys are present", async () => {
  await withFakeSshDir({ id_ed25519: ENCRYPTED, id_rsa: ENCRYPTED }, async () => {
    const { single, all } = await assertEquivalent();
    assert.strictEqual(single, null);
    assert.strictEqual(all.length, 0);
  });
});

test("preferred ordering: a non-preferred key never wins over a preferred one", async () => {
  await withFakeSshDir(
    { id_aaa_custom: UNENCRYPTED("aaa"), id_rsa: UNENCRYPTED("rsa") },
    async () => {
      const { single } = await assertEquivalent();
      // id_rsa is in PREFERRED_KEY_NAMES; id_aaa_custom is not, despite sorting first.
      assert.strictEqual(single.keyName, "id_rsa");
    },
  );
});
