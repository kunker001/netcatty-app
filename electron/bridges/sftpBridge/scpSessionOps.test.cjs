/**
 * Integration-style tests: SCP-mode clients registered in sftpClients are
 * reachable through the same list/mkdir/write entry points the UI and AI tools use.
 */
"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { createScpBackend, isScpModeClient } = require("./scpBackend.cjs");
const { createFileOpsApi } = require("./fileOps.cjs");
const { SCP_OK, buildFileControlLine } = require("./scpProtocol.cjs");

function createMockStream() {
  const ee = new EventEmitter();
  ee.writable = true;
  ee.readable = true;
  ee.stderr = new EventEmitter();
  ee.write = (buf, cb) => {
    ee.emit("_write", Buffer.from(buf));
    if (typeof cb === "function") cb();
    return true;
  };
  ee.end = (cb) => { if (typeof cb === "function") cb(); };
  ee.close = () => ee.emit("close");
  ee.destroy = () => ee.emit("close");
  ee.pushFromRemote = (buf) => ee.emit("data", Buffer.from(buf));
  return ee;
}

describe("SCP-mode session ops via fileOps entry points (AI/UI shared path)", () => {
  let sftpClients;
  let api;
  let commands;
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-scp-session-"));
    sftpClients = new Map();
    commands = [];

    const backend = createScpBackend({
      exec: async (command) => {
        commands.push(command);
        if (command.includes("for f in") || command.includes("cd ")) {
          const name = Buffer.from("agent.txt").toString("base64");
          return {
            stdout: `f|-rw-r--r--|4|1700000000|${name}\n`,
            stderr: "",
            code: 0,
          };
        }
        if (command.includes("mkdir")) return { stdout: "", stderr: "", code: 0 };
        if (command.includes("rm ") || command.includes("rmdir")) return { stdout: "", stderr: "", code: 0 };
        if (command.includes("mv ")) return { stdout: "", stderr: "", code: 0 };
        if (command.includes("$HOME") || command.startsWith("printf")) {
          return { stdout: "/home/agent\n", stderr: "", code: 0 };
        }
        if (command.includes("if [ ! -e")) {
          return {
            stdout: "f|-rw-r--r--|4|1700000000|/home/agent/agent.txt\n",
            stderr: "",
            code: 0,
          };
        }
        return { stdout: "", stderr: "", code: 0 };
      },
      execStream: async (command) => {
        commands.push(command);
        const stream = createMockStream();
        if (command.includes("scp -t")) {
          setImmediate(() => stream.pushFromRemote(Buffer.from([SCP_OK])));
          stream.on("_write", (buf) => {
            const text = buf.toString("utf8");
            if (text.startsWith("C") || (buf.length === 1 && buf[0] === 0x00)) {
              setImmediate(() => stream.pushFromRemote(Buffer.from([SCP_OK])));
            }
          });
        } else if (command.includes("scp -f")) {
          let ackCount = 0;
          stream.on("_write", (buf) => {
            if (!(buf[0] === SCP_OK && buf.length === 1)) return;
            ackCount += 1;
            if (ackCount === 1) {
              setImmediate(() => {
                stream.pushFromRemote(buildFileControlLine({ mode: 0o644, size: 4, name: "agent.txt" }));
              });
            } else if (ackCount === 2) {
              setImmediate(() => {
                stream.pushFromRemote(Buffer.concat([Buffer.from("data"), Buffer.from([0x00])]));
              });
            }
          });
        }
        return stream;
      },
    });

    const client = {
      client: { exec: () => {} },
      sftp: null,
      __netcattyFileProtocol: "scp",
      __netcattyScpBackend: backend,
      async end() {},
    };
    sftpClients.set("scp-session-1", client);

    // Minimal ctx for createFileOpsApi — only what list/mkdir/rename/delete/write need
    api = createFileOpsApi({
      get sftpClients() { return sftpClients; },
      get electronModule() {
        return {
          webContents: { fromId: () => ({ send: () => {} }) },
        };
      },
      fileWatcherBridge: { stopWatchersForSession: () => {} },
      fs,
      path,
      Buffer,
      console,
      setTimeout,
      clearTimeout,
      jumpConnectionsMap: new Map(),
      sftpEncodingState: new Map(),
      normalizeEncoding: (e) => e || "utf-8",
      isAsciiString: () => true,
      requireSftpChannel: async () => { throw new Error("should not use SFTP channel in SCP mode"); },
      resolveEncodingForRequest: () => "utf-8",
      updateResolvedEncoding: () => "utf-8",
      encodePath: (p) => p,
      decodeName: (n) => n,
      detectEncodingFromList: () => null,
      statResultFromAttrs: (a) => a,
      normalizeRemotePathString: async (_c, p) => p,
      collectReadable: async () => Buffer.alloc(0),
      writeToWritable: async () => {},
      throwIfAborted: () => {},
      pipeStreams: async () => {},
      ensureRemoteDirForSession: async () => true,
      removeRemotePathInternal: async () => {},
      renameRemotePath: async () => {},
      realpathAsync: async () => "/",
      statAsync: async () => ({}),
      readdirAsync: async () => [],
      mkdirAsync: async () => {},
      rmdirAsync: async () => {},
      unlinkAsync: async () => {},
      openFileAsync: async () => ({}),
      writeFileChunkAsync: async () => {},
      closeFileAsync: async () => {},
      createAbortError: (s, m) => new Error(m),
      copySftpEncodingState: () => {},
      clearSftpEncodingState: () => {},
      safeSend: () => {},
      tempDirBridge: { getTempFilePath: (n) => path.join(tmpDir, n) },
      randomUUID: () => "test-uuid",
    });
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("marks clients as SCP-mode", () => {
    assert.equal(isScpModeClient(sftpClients.get("scp-session-1")), true);
  });

  it("list works for SCP-mode session id (AI sftp.list path)", async () => {
    const entries = await api.listSftp(null, { sftpId: "scp-session-1", path: "/home/agent" });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, "agent.txt");
    assert.ok(commands.some((c) => c.includes("cd ") || c.includes("for f in")));
  });

  it("mkdir write-class op works for SCP-mode session (AI sftp.mkdir path)", async () => {
    const ok = await api.mkdirSftp(null, { sftpId: "scp-session-1", path: "/home/agent/newdir" });
    assert.equal(ok, true);
    assert.ok(commands.some((c) => c.includes("mkdir") && c.includes("/home/agent/newdir")));
  });

  it("rename and delete work for SCP-mode session", async () => {
    await api.renameSftp(null, {
      sftpId: "scp-session-1",
      oldPath: "/home/agent/a",
      newPath: "/home/agent/b",
    });
    await api.deleteSftp(null, { sftpId: "scp-session-1", path: "/home/agent/b" });
    assert.ok(commands.some((c) => c.includes("mv --")));
    assert.ok(commands.some((c) => c.includes("rm ")));
  });

  it("write + homeDir work for SCP-mode session", async () => {
    await api.writeSftp(null, {
      sftpId: "scp-session-1",
      path: "/home/agent/out.txt",
      content: "hi\n",
    });
    assert.ok(commands.some((c) => c.includes("scp -t")));
    const home = await api.getSftpHomeDir(null, { sftpId: "scp-session-1" });
    assert.equal(home.success, true);
    assert.equal(home.homeDir, "/home/agent");
  });
});
