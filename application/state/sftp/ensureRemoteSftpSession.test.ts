import assert from "node:assert/strict";
import test from "node:test";

import type { Host } from "../../../domain/models";
import { ensureRemoteSftpSession, probeSftpSession } from "./ensureRemoteSftpSession";
import type { SftpPane } from "./types";

const host = {
  id: "host-1",
  label: "CI-Build-01",
  hostname: "ci.example",
  port: 22,
  username: "root",
  protocol: "ssh",
} as Host;

const remotePane = (connectionId: string): SftpPane => ({
  id: "pane-1",
  connection: {
    id: connectionId,
    hostId: "host-1",
    hostLabel: "CI-Build-01",
    isLocal: false,
    status: "connected",
    currentPath: "/root",
  },
  files: [],
  loading: false,
  reconnecting: false,
  error: null,
  selectedFiles: new Set(),
  filter: "",
  filenameEncoding: "auto",
  showHiddenFiles: false,
  connectionLogs: [],
} as unknown as SftpPane);

const noopReleaseConnection = async () => {};

test("SFTP session probe accepts a virtual root directory", async () => {
  const calls: Array<[string, string]> = [];
  const ok = await probeSftpSession({
    realpathSftp: async (sftpId, remotePath) => {
      calls.push([sftpId, remotePath]);
      return "/";
    },
  }, "sftp-jumpserver");

  assert.equal(ok, true);
  assert.deepEqual(calls, [["sftp-jumpserver", "."]]);
});

test("SFTP session probe does not require home discovery", async () => {
  const ok = await probeSftpSession(undefined, "sftp-live");
  assert.equal(ok, true);
});

test("returns an existing mapped SFTP session without reconnecting", async () => {
  let connectCalls = 0;
  const sftpId = await ensureRemoteSftpSession({
    side: "left",
    getActivePane: () => remotePane("conn-1"),
    sftpSessionsRef: { current: new Map([["conn-1", "sftp-live"]]) },
    lastConnectedHostRef: { current: { left: host, right: null } },
    connect: async () => { connectCalls += 1; },
    releaseConnection: noopReleaseConnection,
  });
  assert.equal(sftpId, "sftp-live");
  assert.equal(connectCalls, 0);
});

test("reconnects when the mapped session is missing", async () => {
  let connectCalls = 0;
  const sessions = { current: new Map<string, string>() };
  const sftpId = await ensureRemoteSftpSession({
    side: "left",
    getActivePane: () => {
      // After reconnect, connection id stays and mapping is filled by connect mock.
      return remotePane("conn-1");
    },
    sftpSessionsRef: sessions,
    lastConnectedHostRef: { current: { left: host, right: null } },
    connect: async () => {
      connectCalls += 1;
      sessions.current.set("conn-1", "sftp-reconnected");
    },
    releaseConnection: noopReleaseConnection,
  });
  assert.equal(connectCalls, 1);
  assert.equal(sftpId, "sftp-reconnected");
});

test("resolves source session when restoring a missing browse session", async () => {
  let connectOptions: { initialPath?: string; sourceSessionId?: string } | undefined;
  let resolvedHost: Host | undefined;
  const sessions = { current: new Map<string, string>() };
  const sftpId = await ensureRemoteSftpSession({
    side: "left",
    getActivePane: () => remotePane("conn-1"),
    sftpSessionsRef: sessions,
    lastConnectedHostRef: { current: { left: host, right: null } },
    resolveSourceSessionId: (hostId, reconnectHost) => {
      resolvedHost = reconnectHost;
      return hostId === "host-1" ? "term-1" : undefined;
    },
    connect: async (_side, _host, options) => {
      connectOptions = options;
      sessions.current.set("conn-1", "sftp-restored");
    },
    releaseConnection: noopReleaseConnection,
  });
  assert.equal(sftpId, "sftp-restored");
  assert.equal(resolvedHost?.hostname, "ci.example");
  assert.equal(connectOptions?.initialPath, "/root");
  assert.equal(connectOptions?.sourceSessionId, "term-1");
});

test("forceReconnect reopens even when a mapping exists", async () => {
  let connectCalls = 0;
  const released: string[] = [];
  const sessions = { current: new Map([["conn-1", "sftp-stale"]]) };
  const sftpId = await ensureRemoteSftpSession({
    side: "left",
    getActivePane: () => remotePane("conn-1"),
    sftpSessionsRef: sessions,
    lastConnectedHostRef: { current: { left: host, right: null } },
    forceReconnect: true,
    releaseConnection: async (connectionId) => { released.push(connectionId); },
    connect: async () => {
      connectCalls += 1;
      sessions.current.set("conn-1", "sftp-new");
    },
  });
  assert.equal(connectCalls, 1);
  assert.deepEqual(released, ["conn-1"]);
  assert.equal(sftpId, "sftp-new");
});

test("probe failure triggers reconnect", async () => {
  let connectCalls = 0;
  const released: string[] = [];
  const sessions = { current: new Map([["conn-1", "sftp-dead"]]) };
  const sftpId = await ensureRemoteSftpSession({
    side: "left",
    getActivePane: () => remotePane("conn-1"),
    sftpSessionsRef: sessions,
    lastConnectedHostRef: { current: { left: host, right: null } },
    probeSession: async () => {
      throw new Error("SFTP session not found");
    },
    releaseConnection: async (connectionId) => { released.push(connectionId); },
    connect: async () => {
      connectCalls += 1;
      sessions.current.set("conn-1", "sftp-fresh");
    },
  });
  assert.equal(connectCalls, 1);
  assert.deepEqual(released, ["conn-1"]);
  assert.equal(sftpId, "sftp-fresh");
});

test("uses resolveHostById when lastConnectedHostRef is empty", async () => {
  let connectedHost: Host | "local" | null = null;
  const sessions = { current: new Map<string, string>() };
  const sftpId = await ensureRemoteSftpSession({
    side: "left",
    getActivePane: () => remotePane("conn-1"),
    sftpSessionsRef: sessions,
    lastConnectedHostRef: { current: { left: null, right: null } },
    resolveHostById: (id) => (id === "host-1" ? host : null),
    connect: async (_side, resolved) => {
      connectedHost = resolved;
      sessions.current.set("conn-1", "sftp-vault");
    },
    releaseConnection: noopReleaseConnection,
  });
  assert.equal(sftpId, "sftp-vault");
  assert.equal((connectedHost as Host).hostname, "ci.example");
  assert.equal((connectedHost as Host).username, "root");
});

test("prefers per-tab connect-time host over vault base endpoint", async () => {
  const vaultHost = {
    ...host,
    hostname: "vault.example",
    port: 22,
    username: "root",
  } as Host;
  const sessionHost = {
    ...host,
    hostname: "session.example",
    port: 2222,
    username: "override",
  } as Host;
  let connectedHost: Host | "local" | null = null;
  const sessions = { current: new Map<string, string>() };
  await ensureRemoteSftpSession({
    side: "left",
    getActivePane: () => remotePane("conn-1"),
    sftpSessionsRef: sessions,
    lastConnectedHostRef: { current: { left: null, right: null } },
    resolveConnectedHost: (id) => (id === "pane-1" ? sessionHost : null),
    resolveHostById: () => vaultHost,
    connect: async (_side, resolved) => {
      connectedHost = resolved;
      sessions.current.set("conn-1", "sftp-session");
    },
    releaseConnection: noopReleaseConnection,
  });
  assert.equal((connectedHost as Host).hostname, "session.example");
  assert.equal((connectedHost as Host).port, 2222);
  assert.equal((connectedHost as Host).username, "override");
});

test("does not retarget background reconnect via side-wide lastConnectedHost overrides", async () => {
  const vaultHost = {
    ...host,
    hostname: "vault.example",
    port: 22,
    username: "root",
  } as Host;
  const activeTabOverrides = {
    ...host,
    hostname: "other-tab.example",
    port: 2222,
    username: "other",
  } as Host;
  let connectedHost: Host | "local" | null = null;
  const sessions = { current: new Map<string, string>() };
  await ensureRemoteSftpSession({
    side: "left",
    getActivePane: () => remotePane("conn-1"),
    sftpSessionsRef: sessions,
    lastConnectedHostRef: { current: { left: activeTabOverrides, right: null } },
    resolveHostById: () => vaultHost,
    connect: async (_side, resolved) => {
      connectedHost = resolved;
      sessions.current.set("conn-1", "sftp-vault");
    },
    releaseConnection: noopReleaseConnection,
  });
  assert.equal((connectedHost as Host).hostname, "vault.example");
  assert.equal((connectedHost as Host).port, 22);
});

test("refuses synthetic root@label:22 when host metadata is missing", async () => {
  await assert.rejects(
    () => ensureRemoteSftpSession({
      side: "left",
      getActivePane: () => remotePane("conn-1"),
      sftpSessionsRef: { current: new Map() },
      lastConnectedHostRef: { current: { left: null, right: null } },
      connect: async () => {
        throw new Error("should not connect");
      },
      releaseConnection: noopReleaseConnection,
    }),
    /credentials are unavailable/,
  );
});
