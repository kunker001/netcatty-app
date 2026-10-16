/**
 * Credential Bridge - Field-level encryption for sensitive data at rest
 *
 * Uses Electron's safeStorage API to encrypt individual sensitive fields
 * (passwords, tokens, private keys) before they are persisted to localStorage.
 *
 * Sentinel prefix "enc:v1:" on encrypted values enables:
 * - Detection of already-encrypted vs plaintext (migration)
 * - No double-encryption
 * - Future re-keying with enc:v2: etc.
 *
 * When safeStorage is unavailable (e.g. Linux without libsecret), all values
 * pass through unmodified so the app still works.
 */

const ENC_PREFIX = "enc:v1:";

/**
 * Chromium/Electron safeStorage ciphertext carries known platform headers:
 * - macOS/Linux: plaintext bytes start with "v10" or "v11"
 * - Windows (legacy DPAPI blob): leading bytes are 0x01 0x00 0x00 0x00
 *
 * Detect headers on *decoded* bytes. A four-byte DPAPI version alone is not
 * enough — real blobs continue with provider GUID
 * {df9d8cd0-1501-11d1-8c7a-00c04fc297eb} (base64 `AQAAANCMnd8...`).
 *
 * Keep in sync with domain/credentials.ts.
 *
 * v10/v11 CBC blobs are at least header(3) + one AES block(16) = 19 bytes.
 * AES-GCM blobs are larger (nonce+tag), but CBC is the lower bound we must
 * accept so short credentials are not mistaken for plaintext coincidences.
 */
const V10_HEADER = Buffer.from("v10", "utf8");
const V11_HEADER = Buffer.from("v11", "utf8");
// Version (4) + provider GUID {df9d8cd0-1501-11d1-8c7a-00c04fc297eb} (16).
const DPAPI_BLOB_PREFIX = Buffer.from([
  0x01, 0x00, 0x00, 0x00,
  0xd0, 0x8c, 0x9d, 0xdf, 0x01, 0x15, 0xd1, 0x11,
  0x8c, 0x7a, 0x00, 0xc0, 0x4f, 0xc2, 0x97, 0xeb,
]);

const MIN_V10_V11_CIPHERTEXT_BYTES = 19;
const MIN_V10_V11_GCM_CIPHERTEXT_BYTES = 31; // header(3) + nonce(12) + tag(16)
// Header alone is 20 bytes; require at least one trailing payload byte.
const MIN_DPAPI_CIPHERTEXT_BYTES = DPAPI_BLOB_PREFIX.byteLength + 1;

const BASE64_RE = /^[A-Za-z0-9+/]+=*$/;

let safeStorage = null;

function startsWithBytes(buffer, prefix) {
  if (buffer.byteLength < prefix.byteLength) return false;
  return buffer.subarray(0, prefix.byteLength).equals(prefix);
}

/** CBC is header(3) + 16-byte blocks; GCM is at least header+nonce+tag (31). */
function isValidV10V11CiphertextLength(byteLength) {
  if (byteLength >= MIN_V10_V11_GCM_CIPHERTEXT_BYTES) return true;
  return byteLength >= MIN_V10_V11_CIPHERTEXT_BYTES
    && (byteLength - 3) % 16 === 0;
}

function looksLikeEncryptedCredential(value) {
  if (typeof value !== "string" || !value.startsWith(ENC_PREFIX)) {
    return false;
  }
  const payload = value.slice(ENC_PREFIX.length);
  if (!payload || !BASE64_RE.test(payload)) return false;
  // Reject header-only / truncated base64 that is not a full platform blob.
  let decoded;
  try {
    decoded = Buffer.from(payload, "base64");
  } catch {
    return false;
  }
  if (startsWithBytes(decoded, V10_HEADER) || startsWithBytes(decoded, V11_HEADER)) {
    return isValidV10V11CiphertextLength(decoded.byteLength);
  }
  if (startsWithBytes(decoded, DPAPI_BLOB_PREFIX)) {
    return decoded.byteLength >= MIN_DPAPI_CIPHERTEXT_BYTES;
  }
  return false;
}

/**
 * Encrypt a credential field. Never wraps an existing complete device-bound
 * enc:v1 blob again — even when trial decrypt fails (e.g. OSCrypt key
 * rotated). Ambiguous `enc:v1:` prefixes that are not full ciphertext are
 * treated as coincidental plaintext and encrypted normally.
 *
 * @param {string} plaintext
 * @param {{ isEncryptionAvailable?: () => boolean, encryptString?: (v: string) => Buffer, decryptString?: (b: Buffer) => string } | null} storage
 */
function encryptCredentialValue(plaintext, storage = safeStorage) {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    return plaintext ?? "";
  }
  if (!storage?.isEncryptionAvailable?.()) {
    return plaintext;
  }

  // Complete device-bound ciphertext: return as-is. Do not trial-decrypt then
  // fall through to encryptString — that double-wraps when decrypt fails.
  if (looksLikeEncryptedCredential(plaintext)) {
    return plaintext;
  }

  // Ambiguous enc:v1: prefix (header-only / short coincidence): try decrypt.
  // Success means a real blob we failed to classify — keep it. Failure means
  // plaintext that happens to look prefixed — encrypt it.
  if (plaintext.startsWith(ENC_PREFIX) && typeof storage.decryptString === "function") {
    try {
      const base64 = plaintext.slice(ENC_PREFIX.length);
      const buf = Buffer.from(base64, "base64");
      storage.decryptString(buf);
      return plaintext;
    } catch {
      // coincidental plaintext — fall through
    }
  }

  try {
    const encrypted = storage.encryptString(plaintext);
    return ENC_PREFIX + encrypted.toString("base64");
  } catch (err) {
    console.warn("[Credentials] encrypt failed, returning plaintext:", err?.message || err);
    return plaintext;
  }
}

/**
 * Decrypt a credential field. On failure returns the ciphertext unchanged so
 * callers can detect enc:v1 placeholders via looksLikeEncryptedCredential /
 * isEncryptedCredentialPlaceholder.
 *
 * @param {string} value
 * @param {{ isEncryptionAvailable?: () => boolean, decryptString?: (b: Buffer) => string } | null} storage
 */
function decryptCredentialValue(value, storage = safeStorage) {
  if (typeof value !== "string" || value.length === 0) {
    return value ?? "";
  }
  if (!value.startsWith(ENC_PREFIX)) {
    return value;
  }
  if (!storage?.isEncryptionAvailable?.()) {
    return value;
  }
  try {
    const base64 = value.slice(ENC_PREFIX.length);
    const buf = Buffer.from(base64, "base64");
    return storage.decryptString(buf);
  } catch (err) {
    console.warn("[Credentials] decrypt failed:", err?.message || err);
    return value;
  }
}

/**
 * Register IPC handlers for credential encryption/decryption
 * @param {Electron.IpcMain} ipcMain
 * @param {typeof Electron} electronModule
 */
function registerHandlers(ipcMain, electronModule) {
  safeStorage = electronModule?.safeStorage ?? null;

  ipcMain.handle("netcatty:credentials:available", () => {
    return Boolean(safeStorage?.isEncryptionAvailable?.());
  });

  ipcMain.handle("netcatty:credentials:encrypt", (_event, plaintext) => {
    return encryptCredentialValue(plaintext, safeStorage);
  });

  ipcMain.handle("netcatty:credentials:decrypt", (_event, value) => {
    return decryptCredentialValue(value, safeStorage);
  });
}

module.exports = {
  ENC_PREFIX,
  MIN_V10_V11_CIPHERTEXT_BYTES,
  MIN_DPAPI_CIPHERTEXT_BYTES,
  looksLikeEncryptedCredential,
  encryptCredentialValue,
  decryptCredentialValue,
  registerHandlers,
};
