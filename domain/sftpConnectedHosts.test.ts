import assert from "node:assert/strict";
import test from "node:test";

import type { Host, TerminalSession } from "./models";
import {
  listSftpConnectedHosts,
  resolveSftpTransferSourceSessionId,
  sftpHostEndpointsEqual,
  sftpPickerSessionsEqual,
  sftpSourceSessionIdForHost,
} from "./sftpConnectedHosts";

const host = (overrides: Partial<Host> & Pick<Host, "id" | "label">): Host => ({
  hostname: `${overrides.id}.example.test`,
  username: "alice",
  port: 22,
  protocol: "ssh",
  tags: [],
  os: "linux",
  ...overrides,
});

const session = (
  overrides: Partial<TerminalSession> & Pick<TerminalSession, "id" | "hostId" | "status">,
): TerminalSession => ({
  hostLabel: overrides.hostId,
  username: "alice",
  hostname: `${overrides.hostId}.example.test`,
  protocol: "ssh",
  ...overrides,
});

test("listSftpConnectedHosts returns connected SSH hosts sorted by label", () => {
  const hosts = [
    host({ id: "b", label: "Bravo" }),
    host({ id: "a", label: "Alpha" }),
  ];
  const hostsById = new Map(hosts.map((h) => [h.id, h]));
  const sessions = [
    session({ id: "s-b", hostId: "b", status: "connected" }),
    session({ id: "s-a", hostId: "a", status: "connected" }),
  ];

  const result = listSftpConnectedHosts(sessions, hostsById);
  assert.deepEqual(
    result.map((entry) => [entry.host.id, entry.sessionId, entry.status]),
    [
      ["a", "s-a", "connected"],
      ["b", "s-b", "connected"],
    ],
  );
});

test("listSftpConnectedHosts prefers the later reusable session for a host", () => {
  const hostsById = new Map([["a", host({ id: "a", label: "Alpha" })]]);
  const sessions = [
    session({ id: "s-old", hostId: "a", status: "connected" }),
    session({ id: "s-new", hostId: "a", status: "connected" }),
  ];

  const result = listSftpConnectedHosts(sessions, hostsById);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.sessionId, "s-new");
});

test("listSftpConnectedHosts skips connecting sessions", () => {
  const hostsById = new Map([["a", host({ id: "a", label: "Alpha" })]]);
  const sessions = [
    session({ id: "s-connecting", hostId: "a", status: "connecting" }),
  ];

  assert.deepEqual(listSftpConnectedHosts(sessions, hostsById), []);
});

test("listSftpConnectedHosts skips mosh and et sessions", () => {
  const hosts = [
    host({ id: "ssh", label: "SSH" }),
    host({ id: "mosh", label: "Mosh" }),
    host({ id: "et", label: "ET" }),
  ];
  const hostsById = new Map(hosts.map((h) => [h.id, h]));
  const sessions = [
    session({ id: "s-ssh", hostId: "ssh", status: "connected" }),
    session({ id: "s-mosh", hostId: "mosh", status: "connected", moshEnabled: true }),
    session({ id: "s-et", hostId: "et", status: "connected", etEnabled: true }),
  ];

  const result = listSftpConnectedHosts(sessions, hostsById);
  assert.deepEqual(
    result.map((entry) => entry.sessionId),
    ["s-ssh"],
  );
});

test("listSftpConnectedHosts keeps plain SSH sessions even when vault host defaults to mosh/et", () => {
  const hostsById = new Map([
    ["a", host({ id: "a", label: "Alpha", moshEnabled: true, etEnabled: true })],
  ]);
  const sessions = [
    session({ id: "s-ssh-deeplink", hostId: "a", status: "connected", moshEnabled: false, etEnabled: false }),
  ];

  const result = listSftpConnectedHosts(sessions, hostsById);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.sessionId, "s-ssh-deeplink");
});

test("listSftpConnectedHosts includes hosts with SFTP sudo for picker display", () => {
  const hostsById = new Map([
    ["a", host({ id: "a", label: "Alpha", sftpSudo: true })],
  ]);
  const sessions = [
    session({ id: "s-sudo", hostId: "a", status: "connected" }),
  ];

  const result = listSftpConnectedHosts(sessions, hostsById);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.sessionId, "s-sudo");
  assert.equal(result[0]?.host.sftpSudo, true);
  // Sudo SFTP still opens a new subsystem/channel, but it should borrow the
  // already-authenticated SSH transport before falling back to fresh auth.
  assert.equal(
    resolveSftpTransferSourceSessionId(sessions, hostsById, "a", result[0]?.host),
    "s-sudo",
  );
  assert.equal(sftpSourceSessionIdForHost(result[0]?.host, result[0]?.sessionId), "s-sudo");
});

test("sftpSourceSessionIdForHost keeps sudo and non-sudo reuse hints", () => {
  assert.equal(
    sftpSourceSessionIdForHost(host({ id: "a", label: "Alpha" }), "s1"),
    "s1",
  );
  assert.equal(
    sftpSourceSessionIdForHost(host({ id: "a", label: "Alpha", sftpSudo: true }), "s1"),
    "s1",
  );
  assert.equal(sftpSourceSessionIdForHost(undefined, "s1"), "s1");
  assert.equal(sftpSourceSessionIdForHost(host({ id: "a", label: "Alpha" }), undefined), undefined);
});

test("listSftpConnectedHosts uses the live session endpoint when the vault host was edited", () => {
  const hostsById = new Map([
    [
      "a",
      host({
        id: "a",
        label: "Alpha",
        hostname: "edited.example.test",
        username: "bob",
        port: 2222,
      }),
    ],
  ]);
  const sessions = [
    session({
      id: "s-live",
      hostId: "a",
      status: "connected",
      hostname: "a.example.test",
      username: "alice",
      port: 22,
    }),
  ];

  const result = listSftpConnectedHosts(sessions, hostsById);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.sessionId, "s-live");
  assert.equal(result[0]?.host.label, "Alpha");
  assert.equal(result[0]?.host.hostname, "a.example.test");
  assert.equal(result[0]?.host.username, "alice");
  assert.equal(result[0]?.host.port, 22);
});

test("listSftpConnectedHosts defaults missing session.port to 22, not the edited vault port", () => {
  const hostsById = new Map([
    ["a", host({ id: "a", label: "Alpha", port: 2222 })],
  ]);
  const sessions = [
    session({
      id: "s-live",
      hostId: "a",
      status: "connected",
      hostname: "a.example.test",
      username: "alice",
      port: undefined,
    }),
  ];

  const result = listSftpConnectedHosts(sessions, hostsById);
  assert.equal(result[0]?.host.port, 22);
});

test("listSftpConnectedHosts skips serial, local, telnet, plugin, and disconnected sessions", () => {
  const hosts = [
    host({ id: "ssh", label: "SSH" }),
    host({ id: "serial", label: "Serial", protocol: "serial" }),
    host({ id: "telnet", label: "Telnet", protocol: "telnet" }),
    host({
      id: "plugin",
      label: "Plugin",
      protocol: "plugin:com.example.transport.connection",
      pluginConnection: { providerId: "com.example.transport.connection", configuration: {} },
    }),
  ];
  const hostsById = new Map(hosts.map((h) => [h.id, h]));
  const sessions = [
    session({ id: "s-ssh", hostId: "ssh", status: "connected" }),
    session({ id: "s-serial", hostId: "serial", status: "connected", protocol: "serial" }),
    session({ id: "s-local", hostId: "ssh", status: "connected", protocol: "local" }),
    session({ id: "s-telnet", hostId: "telnet", status: "connected", protocol: "telnet" }),
    session({
      id: "s-plugin",
      hostId: "plugin",
      status: "connected",
      protocol: "plugin:com.example.transport.connection",
    }),
    session({ id: "s-dead", hostId: "ssh", status: "disconnected" }),
  ];

  const result = listSftpConnectedHosts(sessions, hostsById);
  assert.deepEqual(
    result.map((entry) => entry.sessionId),
    ["s-ssh"],
  );
});

test("listSftpConnectedHosts includes ephemeral hosts present in hostsById", () => {
  const ephemeral = host({ id: "ephemeral-1", label: "Deep Link", ephemeral: true });
  const hostsById = new Map([[ephemeral.id, ephemeral]]);
  const sessions = [
    session({
      id: "s-ephemeral",
      hostId: ephemeral.id,
      status: "connected",
      ephemeralHost: true,
    }),
  ];

  const result = listSftpConnectedHosts(sessions, hostsById);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.host.ephemeral, true);
  assert.equal(result[0]?.sessionId, "s-ephemeral");
});

test("listSftpConnectedHosts skips sessions whose host is missing from the map", () => {
  const result = listSftpConnectedHosts(
    [session({ id: "orphan", hostId: "missing", status: "connected" })],
    new Map(),
  );
  assert.deepEqual(result, []);
});

test("sftpHostEndpointsEqual compares hostname, username, and port", () => {
  const base = host({ id: "a", label: "Alpha", hostname: "a.example.test", username: "alice", port: 22 });
  assert.equal(
    sftpHostEndpointsEqual(base, { hostname: "a.example.test", username: "alice", port: undefined }),
    true,
  );
  assert.equal(
    sftpHostEndpointsEqual(base, { hostname: "a.example.test", username: "bob", port: 22 }),
    false,
  );
  assert.equal(
    sftpHostEndpointsEqual(base, { hostname: "other.example.test", username: "alice", port: 22 }),
    false,
  );
});

test("resolveSftpTransferSourceSessionId matches among multi-tab same hostId endpoints", () => {
  const vault = host({ id: "h1", label: "Prod", hostname: "vault.example.test", username: "vault", port: 22 });
  const hostsById = new Map([["h1", vault]]);
  const sessions = [
    session({
      id: "s-old",
      hostId: "h1",
      status: "connected",
      hostname: "old.example.test",
      username: "alice",
      port: 22,
    }),
    session({
      id: "s-new",
      hostId: "h1",
      status: "connected",
      hostname: "new.example.test",
      username: "bob",
      port: 2222,
    }),
  ];
  // Picker collapses to one entry; transfer source must still find the older endpoint.
  assert.equal(
    listSftpConnectedHosts(sessions, hostsById).length,
    1,
  );
  assert.equal(
    resolveSftpTransferSourceSessionId(sessions, hostsById, "h1", {
      hostname: "old.example.test",
      username: "alice",
      port: 22,
    }),
    "s-old",
  );
  assert.equal(
    resolveSftpTransferSourceSessionId(sessions, hostsById, "h1", {
      hostname: "new.example.test",
      username: "bob",
      port: 2222,
    }),
    "s-new",
  );
  // Without endpoint preference, last reusable session for hostId wins.
  assert.equal(resolveSftpTransferSourceSessionId(sessions, hostsById, "h1"), "s-new");
});

test("resolveSftpTransferSourceSessionId ignores SFTP browse connection ids", () => {
  const vault = host({ id: "h1", label: "Prod", hostname: "prod.example.test", username: "alice", port: 22 });
  const hostsById = new Map([["h1", vault]]);
  const sessions = [
    session({
      id: "terminal-ssh-1",
      hostId: "h1",
      status: "connected",
      hostname: "prod.example.test",
      username: "alice",
      port: 22,
    }),
    session({
      id: "sftp-left-accidental-browse-id",
      hostId: "h1",
      status: "connected",
      hostname: "prod.example.test",
      username: "alice",
      port: 22,
    }),
  ];

  assert.equal(
    resolveSftpTransferSourceSessionId(sessions, hostsById, "h1", vault),
    "terminal-ssh-1",
  );
});

test("sftpPickerSessionsEqual ignores title-only changes", () => {
  const prev = [session({ id: "s1", hostId: "a", status: "connected", dynamicTitle: "old" })];
  const next = [session({ id: "s1", hostId: "a", status: "connected", dynamicTitle: "new" })];
  assert.equal(sftpPickerSessionsEqual(prev, next), true);
});

test("sftpPickerSessionsEqual detects session reorder for same-host preference", () => {
  const a = session({ id: "s-a", hostId: "h", status: "connected" });
  const b = session({ id: "s-b", hostId: "h", status: "connected" });
  assert.equal(sftpPickerSessionsEqual([a, b], [b, a]), false);
});

test("sftpPickerSessionsEqual detects status, hostId, transport, and endpoint changes", () => {
  const base = session({ id: "s1", hostId: "a", status: "connected" });
  assert.equal(
    sftpPickerSessionsEqual([base], [session({ id: "s1", hostId: "a", status: "connecting" })]),
    false,
  );
  assert.equal(
    sftpPickerSessionsEqual([base], [session({ id: "s1", hostId: "b", status: "connected" })]),
    false,
  );
  assert.equal(
    sftpPickerSessionsEqual(
      [base],
      [session({ id: "s1", hostId: "a", status: "connected", moshEnabled: true })],
    ),
    false,
  );
  assert.equal(
    sftpPickerSessionsEqual(
      [base],
      [session({ id: "s1", hostId: "a", status: "connected", hostname: "other.example.test" })],
    ),
    false,
  );
});
