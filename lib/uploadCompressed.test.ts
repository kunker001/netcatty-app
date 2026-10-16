import assert from "node:assert/strict";
import test from "node:test";

import { uploadFoldersCompressed } from "./uploadCompressed";
import type { DropEntry } from "./sftpFileUtils";

test("compressed folder uploads use reconstructed drop-entry paths", async () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      netcatty: {
        checkCompressedUploadSupport: async () => ({
          supported: false,
          localTar: false,
          remoteTar: false,
        }),
      },
    },
  });

  try {
    const entry: DropEntry = {
      file: { name: "child.txt", size: 1 } as File,
      localPath: "/tmp/example-folder/child.txt",
      relativePath: "example-folder/child.txt",
      isDirectory: false,
    };
    const results = await uploadFoldersCompressed(
      [["example-folder", [entry]]],
      "/remote",
      "sftp-1",
    );

    assert.deepEqual(results, [{
      fileName: "example-folder",
      success: false,
      error: "Compressed upload not supported - fallback needed",
    }]);
  } finally {
    if (previousWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    }
  }
});

test("compressed folder totals exclude directory entries", async () => {
  const previousWindow = globalThis.window;
  const started: Array<{ totalBytes: number; folderPath: string }> = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      netcatty: {
        checkCompressedUploadSupport: async () => ({
          supported: true,
          localTar: true,
          remoteTar: true,
        }),
        startCompressedUpload: async (options: { totalBytes: number; folderPath: string; compressionId: string }) => {
          started.push({ totalBytes: options.totalBytes, folderPath: options.folderPath });
          return { compressionId: options.compressionId, success: true };
        },
      },
    },
  });

  try {
    const results = await uploadFoldersCompressed(
      [["docs", [
        { file: null, localPath: "/tmp/docs", relativePath: "docs", isDirectory: true, size: 4096 },
        { file: null, localPath: "/tmp/docs/sub", relativePath: "docs/sub", isDirectory: true, size: 4096 },
        { file: null, localPath: "/tmp/docs/a.txt", relativePath: "docs/a.txt", isDirectory: false, size: 10 },
      ]]],
      "/remote",
      "sftp-1",
    );

    assert.deepEqual(results, [{ fileName: "docs", success: true }]);
    assert.deepEqual(started, [{ totalBytes: 10, folderPath: "/tmp/docs" }]);
  } finally {
    if (previousWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    }
  }
});
