/**
 * Shared complete enc:v1 fixtures for tests.
 *
 * Production detectors require a full platform-shaped safeStorage blob
 * (v10/v11 CBC >= 19 bytes, or DPAPI >= 20). Short strings like
 * `enc:v1:djEwAAAA` are no longer treated as ciphertext.
 */

export const MIN_V10_TEST_CIPHERTEXT_BYTES = 19;

export function makeEncryptedCredentialPlaceholder(seed = "fixture"): string {
  const body = Buffer.alloc(MIN_V10_TEST_CIPHERTEXT_BYTES, 0);
  Buffer.from("v10", "utf8").copy(body, 0);
  Buffer.from(String(seed).slice(0, 16), "utf8").copy(body, 3);
  return `enc:v1:${body.toString("base64")}`;
}

/** Stable complete placeholder used by most auth/SFTP/proxy tests. */
export const ENCRYPTED_CREDENTIAL_PLACEHOLDER = makeEncryptedCredentialPlaceholder("test");

/** Alternate complete placeholder (historically `enc:v1:djEwYWJj`). */
export const ENCRYPTED_CREDENTIAL_PLACEHOLDER_ABC = makeEncryptedCredentialPlaceholder("abc");
