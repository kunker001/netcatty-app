import assert from "node:assert/strict";
import test from "node:test";

import {
  openTransferSftpSession,
  resetDedicatedSessionOpenGateForTests,
} from "./dedicatedTransferResume.ts";
import type { Host } from "../../../domain/models.ts";

const host: Host = {
  id: "h1",
  label: "box",
  hostname: "1.2.3.4",
  port: 22,
  username: "root",
  tags: [],
  os: "linux",
  protocol: "ssh",
  authType: "password",
  password: "secret",
  created: 0,
  order: 0,
} as Host;

test("openTransferSftpSession defaults to dedicated vault open (ignores terminal session)", async () => {
  resetDedicatedSessionOpenGateForTests();
  let openSftpCalls = 0;
  let openForSessionCalls = 0;

  const original = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    electron: {
      openSftp: async () => {
        openSftpCalls += 1;
        return "dedicated-sftp";
      },
      openSftpForSession: async () => {
        openForSessionCalls += 1;
        return "session-sftp";
      },
    },
  };

  try {
    // netcattyBridge reads window.electron — ensure adapter path works via mock.
    const { netcattyBridge } = await import("../../../infrastructure/services/netcattyBridge.ts");
    const restore = netcattyBridge.get;
    (netcattyBridge as { get: () => unknown }).get = () => ({
      openSftp: async () => {
        openSftpCalls += 1;
        return "dedicated-sftp";
      },
      openSftpForSession: async () => {
        openForSessionCalls += 1;
        return "session-sftp";
      },
    });

    try {
      const id = await openTransferSftpSession(
        host,
        { hosts: [host], keys: [], identities: [] },
        { sourceSessionId: "term-1", dedicated: true },
      );
      assert.equal(id, "dedicated-sftp");
      assert.equal(openSftpCalls, 1);
      assert.equal(openForSessionCalls, 0, "dedicated bulk path must not use terminal session channel");
    } finally {
      (netcattyBridge as { get: typeof restore }).get = restore;
    }
  } finally {
    if (original === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = original;
    resetDedicatedSessionOpenGateForTests();
  }
});

test("openTransferSftpSession can use terminal session only when dedicated:false", async () => {
  resetDedicatedSessionOpenGateForTests();
  let openForSessionCalls = 0;
  let expectedEndpoint: NetcattySSHOptions | undefined;
  const { netcattyBridge } = await import("../../../infrastructure/services/netcattyBridge.ts");
  const restore = netcattyBridge.get;
  (netcattyBridge as { get: () => unknown }).get = () => ({
    openSftp: async () => "dedicated-sftp",
    openSftpForSession: async (_sessionId: string, endpoint?: NetcattySSHOptions) => {
      openForSessionCalls += 1;
      expectedEndpoint = endpoint;
      return "session-sftp";
    },
  });
  try {
    const id = await openTransferSftpSession(
      host,
      { hosts: [host], keys: [], identities: [] },
      { sourceSessionId: "term-1", dedicated: false },
    );
    assert.equal(id, "session-sftp");
    assert.equal(openForSessionCalls, 1);
    assert.equal(expectedEndpoint?.hostname, host.hostname);
    assert.equal(expectedEndpoint?.password, host.password);
  } finally {
    (netcattyBridge as { get: typeof restore }).get = restore;
    resetDedicatedSessionOpenGateForTests();
  }
});

test("non-dedicated transfer without a terminal keeps unified transport reuse enabled", async () => {
  resetDedicatedSessionOpenGateForTests();
  const seen: NetcattySSHOptions[] = [];
  let openForSessionCalls = 0;
  const { netcattyBridge } = await import("../../../infrastructure/services/netcattyBridge.ts");
  const restore = netcattyBridge.get;
  (netcattyBridge as { get: () => unknown }).get = () => ({
    openSftp: async (options: NetcattySSHOptions) => {
      seen.push(options);
      return "pooled-sftp";
    },
    openSftpForSession: async () => {
      openForSessionCalls += 1;
      return "unexpected-terminal-sftp";
    },
  });
  try {
    const id = await openTransferSftpSession(
      host,
      { hosts: [host], keys: [], identities: [] },
      { dedicated: false },
    );
    assert.equal(id, "pooled-sftp");
    assert.equal(openForSessionCalls, 0);
    assert.equal(seen.length, 1);
    assert.notEqual(seen[0]?.reuseTransport, false);
  } finally {
    (netcattyBridge as { get: typeof restore }).get = restore;
    resetDedicatedSessionOpenGateForTests();
  }
});

test("dedicated transfer delegates key and password fallback to one main-process open", async () => {
  resetDedicatedSessionOpenGateForTests();
  const mixedHost = {
    ...host,
    authMethod: "auto",
    identityFilePaths: ["/tmp/id_ed25519"],
    password: "fallback-password",
  } as Host;
  const seen: NetcattySSHOptions[] = [];
  const { netcattyBridge } = await import("../../../infrastructure/services/netcattyBridge.ts");
  const restore = netcattyBridge.get;
  (netcattyBridge as { get: () => unknown }).get = () => ({
    openSftp: async (options: NetcattySSHOptions) => {
      seen.push(options);
      throw new Error("All configured authentication methods failed");
    },
  });
  try {
    await assert.rejects(
      openTransferSftpSession(mixedHost, { hosts: [mixedHost], keys: [], identities: [] }),
      /authentication/i,
    );
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.password, "fallback-password");
    assert.deepEqual(seen[0]?.identityFilePaths, ["/tmp/id_ed25519"]);
  } finally {
    (netcattyBridge as { get: typeof restore }).get = restore;
    resetDedicatedSessionOpenGateForTests();
  }
});
