import test from "node:test";
import assert from "node:assert/strict";

import {
  captureDropPayload,
  formatDropScanLabel,
  getFileExtension,
  hasFileExtension,
  localTreeToDropEntries,
  materializeDropEntries,
  type LocalTreeListEntry,
} from "./sftpFileUtils.ts";

test("hasFileExtension identifies extensionless and dotted filenames", () => {
  assert.equal(hasFileExtension("nginx"), false);
  assert.equal(hasFileExtension("my-binary"), false);
  assert.equal(hasFileExtension(".git"), false);
  assert.equal(getFileExtension("nginx"), "file");

  assert.equal(hasFileExtension("readme.txt"), true);
  assert.equal(hasFileExtension(".bashrc"), false);
  assert.equal(hasFileExtension("archive.tar.gz"), true);
});

test("formatDropScanLabel summarizes dropped root names", () => {
  assert.equal(formatDropScanLabel([]), "Scanning files...");
  assert.equal(formatDropScanLabel([{ name: "docs", isDirectory: true }]), "docs");
  assert.equal(
    formatDropScanLabel([
      { name: "a", isDirectory: true },
      { name: "b", isDirectory: true },
    ]),
    "a, b",
  );
  assert.equal(
    formatDropScanLabel([
      { name: "a", isDirectory: true },
      { name: "b", isDirectory: true },
      { name: "c", isDirectory: true },
    ]),
    "a, b +1",
  );
});

test("captureDropPayload reads webkit entries synchronously", () => {
  const file = new File(["x"], "note.txt");
  Object.defineProperty(file, "path", { value: "/tmp/note.txt" });
  const dataTransfer = {
    items: [{
      kind: "file",
      getAsFile: () => file,
      webkitGetAsEntry: () => ({
        name: "note.txt",
        isFile: true,
        isDirectory: false,
      }),
    }],
    files: [file],
  } as unknown as DataTransfer;

  const payload = captureDropPayload(dataTransfer);
  assert.equal(payload.roots.length, 1);
  assert.equal(payload.roots[0].name, "note.txt");
  assert.equal(payload.roots[0].isDirectory, false);
  assert.equal(payload.roots[0].localPath, "/tmp/note.txt");
});

test("materializeDropEntries prefers listLocalTree for directory roots with paths", async () => {
  const progress: Array<{ fileCount: number; directoryCount: number }> = [];
  const tree: LocalTreeListEntry[] = [
    {
      localPath: "/tmp/project",
      relativePath: "project",
      type: "directory",
      size: 0,
      lastModified: 1,
    },
    {
      localPath: "/tmp/project/src",
      relativePath: "project/src",
      type: "directory",
      size: 0,
      lastModified: 1,
    },
    {
      localPath: "/tmp/project/src/main.ts",
      relativePath: "project/src/main.ts",
      type: "file",
      size: 12,
      lastModified: 2,
    },
  ];

  const entries = await materializeDropEntries(
    {
      roots: [{
        name: "project",
        isDirectory: true,
        localPath: "/tmp/project",
      }],
      filesFallback: [],
    },
    {
      listLocalTree: async (path, options) => {
        assert.equal(path, "/tmp/project");
        options?.onProgress?.({ fileCount: 1, directoryCount: 2, entryCount: 3 });
        return tree;
      },
      onProgress: (p) => progress.push({ fileCount: p.fileCount, directoryCount: p.directoryCount }),
    },
  );

  assert.deepEqual(
    entries.map((entry) => ({
      relativePath: entry.relativePath,
      isDirectory: entry.isDirectory,
      localPath: entry.localPath,
      size: entry.size,
    })),
    [
      { relativePath: "project", isDirectory: true, localPath: "/tmp/project", size: undefined },
      { relativePath: "project/src", isDirectory: true, localPath: "/tmp/project/src", size: undefined },
      {
        relativePath: "project/src/main.ts",
        isDirectory: false,
        localPath: "/tmp/project/src/main.ts",
        size: 12,
      },
    ],
  );
  assert.ok(progress.some((p) => p.fileCount === 1 && p.directoryCount === 2));
});

test("localTreeToDropEntries preserves file sizes without File handles", () => {
  const entries = localTreeToDropEntries([{
    localPath: "/tmp/a.txt",
    relativePath: "a.txt",
    type: "file",
    size: 42,
    lastModified: 9,
  }]);
  assert.equal(entries[0].file, null);
  assert.equal(entries[0].localPath, "/tmp/a.txt");
  assert.equal(entries[0].size, 42);
});
