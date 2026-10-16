const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ENC_PREFIX,
  MIN_V10_V11_CIPHERTEXT_BYTES,
  MIN_DPAPI_CIPHERTEXT_BYTES,
  encryptCredentialValue,
  decryptCredentialValue,
  looksLikeEncryptedCredential,
} = require("./credentialBridge.cjs");

function fakeSafeStorage({ decryptThrows = false } = {}) {
  const blobs = new Map();
  let nextId = 1;
  return {
    isEncryptionAvailable: () => true,
    encryptString(plaintext) {
      const id = `cipher-${nextId++}`;
      // Pad to a complete CBC-sized blob (header + one AES block).
      const body = Buffer.alloc(MIN_V10_V11_CIPHERTEXT_BYTES, 0);
      Buffer.from("v10", "utf8").copy(body, 0);
      Buffer.from(id, "utf8").copy(body, 3);
      blobs.set(body.toString("base64"), plaintext);
      return body;
    },
    decryptString(buffer) {
      if (decryptThrows) throw new Error("decrypt failed");
      const key = Buffer.from(buffer).toString("base64");
      if (!blobs.has(key)) throw new Error("unknown cipher");
      return blobs.get(key);
    },
  };
}

function completeCiphertextPlaceholder(seed = "stale-key-material") {
  const body = Buffer.alloc(MIN_V10_V11_CIPHERTEXT_BYTES, 0);
  Buffer.from("v10", "utf8").copy(body, 0);
  Buffer.from(seed, "utf8").copy(body, 3);
  return `${ENC_PREFIX}${body.toString("base64")}`;
}

test("looksLikeEncryptedCredential accepts complete CBC-sized v10 payloads", () => {
  assert.equal(looksLikeEncryptedCredential(completeCiphertextPlaceholder()), true);
});

test("looksLikeEncryptedCredential rejects impossible intermediate v10 lengths", () => {
  // 20–30 bytes starting with v10 cannot be CBC (19+16n) or GCM (>=31).
  const body = Buffer.alloc(24, 0);
  Buffer.from("v10", "utf8").copy(body, 0);
  assert.equal(looksLikeEncryptedCredential(`${ENC_PREFIX}${body.toString("base64")}`), false);
});

test("looksLikeEncryptedCredential accepts GCM-sized v10 payloads", () => {
  const body = Buffer.alloc(31, 0);
  Buffer.from("v10", "utf8").copy(body, 0);
  assert.equal(looksLikeEncryptedCredential(`${ENC_PREFIX}${body.toString("base64")}`), true);
});

test("looksLikeEncryptedCredential accepts real Windows DPAPI base64 prefixes", () => {
  // Version + provider GUID {df9d8cd0-1501-11d1-8c7a-00c04fc297eb} + payload.
  const body = Buffer.from([
    0x01, 0x00, 0x00, 0x00,
    0xd0, 0x8c, 0x9d, 0xdf, 0x01, 0x15, 0xd1, 0x11,
    0x8c, 0x7a, 0x00, 0xc0, 0x4f, 0xc2, 0x97, 0xeb,
    0xaa,
  ]);
  const encoded = body.toString("base64");
  assert.equal(encoded.startsWith("AQAAANCMnd8"), true);
  assert.equal(looksLikeEncryptedCredential(`${ENC_PREFIX}${encoded}`), true);
});

test("looksLikeEncryptedCredential rejects version-only DPAPI-looking blobs", () => {
  const body = Buffer.alloc(MIN_DPAPI_CIPHERTEXT_BYTES, 0);
  body[0] = 0x01;
  body[4] = 0xd0;
  body[5] = 0x8c;
  assert.equal(looksLikeEncryptedCredential(`${ENC_PREFIX}${body.toString("base64")}`), false);
});

test("looksLikeEncryptedCredential rejects header-only enc:v1 payloads", () => {
  assert.equal(looksLikeEncryptedCredential(`${ENC_PREFIX}djEw`), false);
  assert.equal(looksLikeEncryptedCredential(`${ENC_PREFIX}not-real-ciphertext`), false);
  assert.equal(looksLikeEncryptedCredential("password"), false);
});

test("encrypt leaves undecryptable DPAPI enc:v1 ciphertext unchanged", () => {
  const storage = fakeSafeStorage({ decryptThrows: true });
  const body = Buffer.from([
    0x01, 0x00, 0x00, 0x00,
    0xd0, 0x8c, 0x9d, 0xdf, 0x01, 0x15, 0xd1, 0x11,
    0x8c, 0x7a, 0x00, 0xc0, 0x4f, 0xc2, 0x97, 0xeb,
    0xaa,
  ]);
  const stale = `${ENC_PREFIX}${body.toString("base64")}`;
  assert.equal(encryptCredentialValue(stale, storage), stale);
});

test("encrypt leaves undecryptable complete enc:v1 ciphertext unchanged instead of wrapping again", () => {
  const storage = fakeSafeStorage({ decryptThrows: true });
  const stale = completeCiphertextPlaceholder("stale-key-material");
  const result = encryptCredentialValue(stale, storage);
  assert.equal(result, stale);
});

test("encrypt encrypts header-only enc:v1 coincidence instead of leaving it plaintext", () => {
  const storage = fakeSafeStorage();
  const coincidence = `${ENC_PREFIX}djEw`;
  const result = encryptCredentialValue(coincidence, storage);
  assert.notEqual(result, coincidence);
  assert.ok(result.startsWith(ENC_PREFIX));
  assert.equal(decryptCredentialValue(result, storage), coincidence);
});

test("encrypt still encrypts coincidental plaintext that starts with enc:v1:", () => {
  const storage = fakeSafeStorage();
  const coincidence = `${ENC_PREFIX}totally-plain-password`;
  const result = encryptCredentialValue(coincidence, storage);
  assert.notEqual(result, coincidence);
  assert.ok(result.startsWith(ENC_PREFIX));
  assert.equal(decryptCredentialValue(result, storage), coincidence);
});

test("encrypt round-trips plaintext and does not double-encrypt", () => {
  const storage = fakeSafeStorage();
  const once = encryptCredentialValue("secret", storage);
  const twice = encryptCredentialValue(once, storage);
  assert.equal(twice, once);
  assert.equal(decryptCredentialValue(once, storage), "secret");
});

test("decrypt returns ciphertext unchanged when safeStorage cannot decrypt", () => {
  const storage = fakeSafeStorage({ decryptThrows: true });
  const stale = completeCiphertextPlaceholder("stale");
  assert.equal(decryptCredentialValue(stale, storage), stale);
});
