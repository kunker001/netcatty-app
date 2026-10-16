import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("useSftpBackend no longer exposes the retired external-edit orchestration", () => {
  const source = readFileSync(new URL("./useSftpBackend.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /downloadSftpToTempAndOpen/);
  assert.doesNotMatch(source, /registerTempFile|startFileWatch|openWithApplication|downloadSftpToTemp/);
});

test("the active external-edit path remains owned by useSftpExternalOperations", () => {
  const source = readFileSync(
    new URL("./sftp/useSftpExternalOperations.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /downloadToTempAndOpen/);
  assert.match(source, /registerTempFile/);
  assert.match(source, /startFileWatch/);
});
