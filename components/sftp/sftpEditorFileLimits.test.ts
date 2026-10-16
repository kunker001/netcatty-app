import assert from "node:assert/strict";
import test from "node:test";

import { assertSftpFileFitsBuiltinEditor, MAX_BUILTIN_SFTP_EDITOR_BYTES } from "./sftpEditorFileLimits.ts";

test("built-in editor rejects oversized files before reading them", () => {
  assert.doesNotThrow(() => assertSftpFileFitsBuiltinEditor(MAX_BUILTIN_SFTP_EDITOR_BYTES));
  assert.throws(
    () => assertSftpFileFitsBuiltinEditor(MAX_BUILTIN_SFTP_EDITOR_BYTES + 1),
    /too large.*10 MB/i,
  );
});
