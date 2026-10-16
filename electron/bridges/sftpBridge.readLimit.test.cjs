"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Readable } = require("node:stream");
const { EventEmitter } = require("node:events");

const { createFileOpsApi } = require("./sftpBridge/fileOps.cjs");

const MAX_IN_MEMORY_READ_BYTES = 10 * 1024 * 1024;

function createApi(client, overrides = {}) {
  return createFileOpsApi({
    sftpClients: new Map([["sftp-1", client]]),
    resolveEncodingForRequest: () => "utf-8",
    encodePath: (value) => value,
    Buffer,
    ...overrides,
  });
}

test("SFTP text reads reject oversized files before opening the data stream", async () => {
  let streamOpened = false;
  const sftp = {
    createReadStream() {
      streamOpened = true;
      throw new Error("oversized file stream should not open");
    },
  };
  const api = createApi({}, {
    requireSftpChannel: async () => sftp,
    statAsync: async () => ({ size: MAX_IN_MEMORY_READ_BYTES + 1 }),
  });

  await assert.rejects(
    api.readSftp(null, { sftpId: "sftp-1", path: "/large.log" }),
    /10 MB.*download.*external app/i,
  );
  assert.equal(streamOpened, false);
});

test("SFTP text reads still stream ordinary files", async () => {
  const sftp = {
    createReadStream() {
      return Readable.from([Buffer.from("hel"), Buffer.from("lo")]);
    },
  };
  const api = createApi({}, {
    requireSftpChannel: async () => sftp,
    statAsync: async () => ({ size: 5 }),
  });

  assert.equal(
    await api.readSftp(null, { sftpId: "sftp-1", path: "/small.txt" }),
    "hello",
  );
});

test("SFTP binary reads reject oversized files before opening the data stream", async () => {
  let streamOpened = false;
  const sftp = {
    createReadStream() {
      streamOpened = true;
      throw new Error("oversized file stream should not open");
    },
  };
  const api = createApi({}, {
    requireSftpChannel: async () => sftp,
    statAsync: async () => ({ size: MAX_IN_MEMORY_READ_BYTES + 1 }),
  });

  await assert.rejects(
    api.readSftpBinary(null, { sftpId: "sftp-1", path: "/large.bin" }),
    /10 MB.*download.*external app/i,
  );
  assert.equal(streamOpened, false);
});

test("SFTP reads stop at the byte limit when the remote file grows after stat", async () => {
  let legacyGetCalled = false;
  const stream = Readable.from([
    Buffer.alloc(MAX_IN_MEMORY_READ_BYTES),
    Buffer.from("x"),
  ]);
  const sftp = {
    createReadStream() {
      return stream;
    },
  };
  const api = createApi({
    async get() {
      legacyGetCalled = true;
      return Buffer.alloc(MAX_IN_MEMORY_READ_BYTES + 1);
    },
  }, {
    requireSftpChannel: async () => sftp,
    statAsync: async () => ({ size: 1 }),
  });

  await assert.rejects(
    api.readSftp(null, { sftpId: "sftp-1", path: "/growing.log" }),
    /10 MB.*download.*external app/i,
  );
  assert.equal(legacyGetCalled, false);
  assert.equal(stream.destroyed, true);
  assert.equal(stream.listenerCount("data"), 0);
  assert.equal(stream.listenerCount("end"), 0);
  assert.equal(stream.listenerCount("error"), 0);
  assert.equal(stream.listenerCount("close"), 0);
});

test("SCP reads reject oversized files before starting the transfer", async () => {
  let readStarted = false;
  const backend = {
    async stat() {
      return { size: MAX_IN_MEMORY_READ_BYTES + 1 };
    },
    async readFile() {
      readStarted = true;
      throw new Error("oversized SCP transfer should not start");
    },
  };
  const api = createApi({
    __netcattyFileProtocol: "scp",
    __netcattyScpBackend: backend,
  });

  await assert.rejects(
    api.readSftp(null, { sftpId: "sftp-1", path: "/large.log" }),
    /10 MB.*download.*external app/i,
  );
  assert.equal(readStarted, false);
});

test("the total in-memory SFTP read deadline also bounds a stalled stat", async () => {
  const api = createApi({}, {
    requireSftpChannel: async () => ({}),
    statAsync: async () => new Promise(() => {}),
  });

  await assert.rejects(
    Promise.race([
      api.readSftp(null, { sftpId: "sftp-1", path: "/stalled.txt", timeoutMs: 5 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("test watchdog")), 100)),
    ]),
    /SFTP in-memory read timed out/i,
  );
});

test("a timed-out in-memory SFTP stream is destroyed and releases every listener", async () => {
  const stream = new EventEmitter();
  let destroyed = 0;
  stream.destroy = () => { destroyed += 1; };
  stream.close = () => { destroyed += 1; };
  const api = createApi({}, {
    requireSftpChannel: async () => ({ createReadStream: () => stream }),
    statAsync: async () => ({ size: 1 }),
  });

  await assert.rejects(
    Promise.race([
      api.readSftpBinary(null, { sftpId: "sftp-1", path: "/stalled.bin", timeoutMs: 5 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("test watchdog")), 100)),
    ]),
    /SFTP in-memory read timed out/i,
  );
  assert.ok(destroyed > 0);
  assert.equal(stream.listenerCount("data"), 0);
  assert.equal(stream.listenerCount("end"), 0);
  assert.equal(stream.listenerCount("error"), 0);
  assert.equal(stream.listenerCount("close"), 0);
});

test("in-memory SFTP stream error and premature close both release listeners", async () => {
  for (const terminalEvent of ["error", "close"]) {
    const stream = new EventEmitter();
    stream.destroy = () => {};
    stream.close = () => {};
    const api = createApi({}, {
      requireSftpChannel: async () => ({ createReadStream: () => stream }),
      statAsync: async () => ({ size: 1 }),
    });
    const reading = api.readSftp(null, { sftpId: "sftp-1", path: "/broken.txt", timeoutMs: 100 });
    process.nextTick(() => {
      if (terminalEvent === "error") stream.emit("error", new Error("read failed"));
      else stream.emit("close");
    });
    await assert.rejects(reading, /read failed|closed before/i);
    assert.equal(stream.listenerCount("data"), 0);
    assert.equal(stream.listenerCount("end"), 0);
    assert.equal(stream.listenerCount("error"), 0);
    assert.equal(stream.listenerCount("close"), 0);
  }
});
