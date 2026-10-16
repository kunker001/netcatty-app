import assert from "node:assert/strict";
import test from "node:test";

import type { DropEntry } from "./sftpFileUtils";
import {
  buildZmodemDragDropFiles,
  buildZmodemDragDropUploadCommand,
  ZMODEM_DEFAULT_RZ_UPLOAD_COMMAND,
} from "./zmodemDragDrop";

test("ZMODEM drag-drop rz command overwrites existing remote files", () => {
  // lrzsz rz defaults to protect mode and refuses same-named files unless -y.
  assert.match(ZMODEM_DEFAULT_RZ_UPLOAD_COMMAND, /\brz\s+-y\b/);
  assert.match(ZMODEM_DEFAULT_RZ_UPLOAD_COMMAND, /\r$/);

  const command = buildZmodemDragDropUploadCommand("rz-token");
  assert.match(command, /\bexec rz -y\b/);
  assert.match(command, /NetcattyRzMissing=rz-token/);
  assert.match(command, /\r$/);
});

test("ZMODEM drops use reconstructed paths without buffering the file", async () => {
  let buffered = false;
  const entry: DropEntry = {
    file: {
      name: "large.bin",
      arrayBuffer: async () => {
        buffered = true;
        return new ArrayBuffer(0);
      },
    } as File,
    localPath: "/tmp/large.bin",
    relativePath: "large.bin",
    isDirectory: false,
  };

  const files = await buildZmodemDragDropFiles([entry]);

  assert.deepEqual(files, [{
    path: "/tmp/large.bin",
    name: "large.bin",
    remoteName: "large.bin",
  }]);
  assert.equal(buffered, false);
});

test("ZMODEM drops accept path-only files from native folder scans", async () => {
  const files = await buildZmodemDragDropFiles([{
    file: null,
    localPath: "/tmp/project/src/main.ts",
    relativePath: "project/src/main.ts",
    isDirectory: false,
  }]);

  assert.deepEqual(files, [{
    path: "/tmp/project/src/main.ts",
    name: "main.ts",
    remoteName: "main.ts",
  }]);
});
