"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { stageRendererFileToTemp } = require("./stageUploadFile.cjs");

function createChunkedFile(chunks) {
  return {
    stream: () => new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
        controller.close();
      },
    }),
  };
}

function createShortWriteFs(writeSizes, onWrite = null) {
  const writeCalls = [];
  let writeIndex = 0;
  return {
    writeCalls,
    fsImpl: {
      promises: {
        open: async (...args) => {
          const handle = await fs.promises.open(...args);
          return {
            write: async (buffer, offset = 0, length = buffer.length - offset, position = null) => {
              const requestedLength = Math.max(0, Number(length));
              const configuredLength = writeSizes[writeIndex] ?? requestedLength;
              const actualLength = Math.min(requestedLength, configuredLength);
              writeCalls.push({ offset, length: requestedLength, position, actualLength });
              const result = await handle.write(buffer, offset, actualLength, position);
              writeIndex += 1;
              await onWrite?.({ writeIndex, result });
              return result;
            },
            close: () => handle.close(),
          };
        },
        unlink: (...args) => fs.promises.unlink(...args),
      },
    },
  };
}

test("pathless renderer files stream into a controlled temp file without arrayBuffer", async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "netcatty-stage-upload-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const localPath = path.join(dir, "upload.part");
  let arrayBufferCalls = 0;
  const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])];
  const file = {
    arrayBuffer: async () => { arrayBufferCalls += 1; return new ArrayBuffer(0); },
    stream: () => new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  };
  assert.equal(await stageRendererFileToTemp(file, localPath, fs), localPath);
  assert.deepEqual(await fs.promises.readFile(localPath), Buffer.from([1, 2, 3, 4, 5]));
  assert.equal(arrayBufferCalls, 0);
});

test("a partial file-handle write retries the unwritten suffix", async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "netcatty-stage-upload-short-write-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const localPath = path.join(dir, "upload.part");
  const { fsImpl, writeCalls } = createShortWriteFs([2]);

  assert.equal(
    await stageRendererFileToTemp(createChunkedFile([[1, 2, 3, 4, 5]]), localPath, fsImpl),
    localPath,
  );
  assert.deepEqual(await fs.promises.readFile(localPath), Buffer.from([1, 2, 3, 4, 5]));
  assert.deepEqual(writeCalls.map(({ offset, length, position }) => ({ offset, length, position })), [
    { offset: 0, length: 5, position: 0 },
    { offset: 2, length: 3, position: 2 },
  ]);
});

test("multiple partial writes across chunks preserve every byte and advance offsets", async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "netcatty-stage-upload-many-short-writes-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const localPath = path.join(dir, "upload.part");
  const { fsImpl, writeCalls } = createShortWriteFs([1, 2, 1, 1]);

  await stageRendererFileToTemp(
    createChunkedFile([[10, 11, 12, 13], [20, 21]]),
    localPath,
    fsImpl,
  );

  assert.deepEqual(await fs.promises.readFile(localPath), Buffer.from([10, 11, 12, 13, 20, 21]));
  assert.deepEqual(writeCalls.map(({ offset, length, position }) => ({ offset, length, position })), [
    { offset: 0, length: 4, position: 0 },
    { offset: 1, length: 3, position: 1 },
    { offset: 3, length: 1, position: 3 },
    { offset: 0, length: 2, position: 4 },
    { offset: 1, length: 1, position: 5 },
  ]);
});

test("a zero-byte file-handle write fails instead of spinning and removes the temp file", async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "netcatty-stage-upload-zero-write-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const localPath = path.join(dir, "upload.part");
  const { fsImpl, writeCalls } = createShortWriteFs([0]);

  await assert.rejects(
    stageRendererFileToTemp(createChunkedFile([[1, 2, 3]]), localPath, fsImpl),
    /Unable to stage the complete upload file/,
  );
  assert.equal(writeCalls.length, 1);
  await assert.rejects(fs.promises.stat(localPath), { code: "ENOENT" });
});

test("cancelling after a partial write stops the current chunk and removes the temp file", async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "netcatty-stage-upload-cancel-short-write-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const localPath = path.join(dir, "upload.part");
  const controller = new AbortController();
  const { fsImpl, writeCalls } = createShortWriteFs([2], ({ writeIndex }) => {
    if (writeIndex === 1) controller.abort(new Error("cancel mid-chunk"));
  });

  await assert.rejects(
    stageRendererFileToTemp(
      createChunkedFile([[1, 2, 3, 4, 5]]),
      localPath,
      fsImpl,
      controller.signal,
    ),
    /cancel mid-chunk/,
  );
  assert.equal(writeCalls.length, 1);
  await assert.rejects(fs.promises.stat(localPath), { code: "ENOENT" });
});

test("failed pathless-file staging removes its partial temp file", async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "netcatty-stage-upload-fail-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const localPath = path.join(dir, "upload.part");
  let reads = 0;
  const file = {
    stream: () => ({
      getReader: () => ({
        read: async () => {
          reads += 1;
          if (reads === 1) return { done: false, value: new Uint8Array([1]) };
          throw new Error("source failed");
        },
        releaseLock: () => {},
      }),
    }),
  };
  await assert.rejects(stageRendererFileToTemp(file, localPath, fs), /source failed/);
  await assert.rejects(fs.promises.stat(localPath), { code: "ENOENT" });
});

test("a synchronous File.stream failure closes the new handle and removes the temp file", async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "netcatty-stage-upload-stream-init-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const localPath = path.join(dir, "upload.part");

  await assert.rejects(stageRendererFileToTemp({
    stream() {
      throw new Error("stream init failed");
    },
  }, localPath, fs), /stream init failed/);

  await assert.rejects(fs.promises.stat(localPath), { code: "ENOENT" });
});

test("a synchronous getReader failure closes the new handle and removes the temp file", async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "netcatty-stage-upload-reader-init-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const localPath = path.join(dir, "upload.part");

  await assert.rejects(stageRendererFileToTemp({
    stream: () => ({
      getReader() {
        throw new Error("reader init failed");
      },
    }),
  }, localPath, fs), /reader init failed/);

  await assert.rejects(fs.promises.stat(localPath), { code: "ENOENT" });
});

test("stream initialization failure still closes the handle when temp deletion fails", async () => {
  let closeCalls = 0;
  let unlinkCalls = 0;
  const fakeFs = {
    promises: {
      open: async () => ({
        close: async () => { closeCalls += 1; },
      }),
      unlink: async () => {
        unlinkCalls += 1;
        throw new Error("delete denied");
      },
    },
  };

  await assert.rejects(stageRendererFileToTemp({
    stream() {
      throw new Error("stream init failed");
    },
  }, "/controlled/upload.part", fakeFs), /stream init failed/);

  assert.equal(unlinkCalls, 1);
  assert.ok(closeCalls >= 1, "the file handle must close even if cleanup unlink fails");
});

test("cancelling a blocked pathless-file read closes it and removes the partial file", async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "netcatty-stage-upload-cancel-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const localPath = path.join(dir, "upload.part");
  const controller = new AbortController();
  let cancelCalls = 0;
  let finishRead;
  const file = {
    stream: () => ({
      getReader: () => ({
        read: () => new Promise((resolve) => { finishRead = resolve; }),
        cancel: async () => {
          cancelCalls += 1;
          finishRead?.({ done: true });
        },
        releaseLock: () => {},
      }),
    }),
  };
  const staging = stageRendererFileToTemp(file, localPath, fs, controller.signal);
  while (!finishRead) await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new Error("cancel now"));
  await assert.rejects(staging, /cancel now/);
  assert.equal(cancelCalls, 1);
  await assert.rejects(fs.promises.stat(localPath), { code: "ENOENT" });
});
