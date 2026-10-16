import assert from "node:assert/strict";
import test from "node:test";

import {
  isTransferNavigationTerminalTabId,
  pickHostForTransferNavigation,
  resolveSftpTransferNavigationHostLabel,
  resolveSftpTransferNavigationPath,
  resolveSftpTransferNavigationTarget,
} from "./sftpTransferNavigation";

test("resume of a direct download opens the remote source host", () => {
  const target = resolveSftpTransferNavigationTarget({
    direction: "download",
    sourceHostId: "host-1",
    targetConnectionId: "local",
    sourceConnectionId: "conn-remote",
    sourcePath: "/root/geoip.metadb",
    targetPath: "/Users/me/Desktop/geoip.metadb",
    isDirectory: false,
  }, true);

  assert.deepEqual(target, {
    kind: "remote-host",
    hostId: "host-1",
    useSourcePath: true,
  });
});

test("resume of a dual-pane download still opens the remote source", () => {
  // Dual-pane local targets use a real connection UUID, not the "local" sentinel.
  const target = resolveSftpTransferNavigationTarget({
    direction: "download",
    sourceHostId: "host-1",
    targetHostId: undefined,
    sourceConnectionId: "conn-remote",
    targetConnectionId: "conn-local-uuid",
    sourcePath: "/root/geoip.metadb",
    targetPath: "/Users/me/Desktop/geoip.metadb",
    isDirectory: false,
  }, true);

  assert.deepEqual(target, {
    kind: "remote-host",
    hostId: "host-1",
    useSourcePath: true,
  });
});

test("opening a finished download target uses the local folder", () => {
  const target = resolveSftpTransferNavigationTarget({
    direction: "download",
    sourceHostId: "host-1",
    targetConnectionId: "conn-local-uuid",
    sourceConnectionId: "conn-remote",
    sourcePath: "/root/geoip.metadb",
    targetPath: "/Users/me/Desktop/geoip.metadb",
    isDirectory: false,
  }, false);

  assert.equal(target.kind, "local-path");
  assert.equal(
    resolveSftpTransferNavigationPath({
      sourcePath: "/root/geoip.metadb",
      targetPath: "/Users/me/Desktop/geoip.metadb",
      isDirectory: false,
    }, false),
    "/Users/me/Desktop",
  );
});

test("resume of an upload opens the remote target host", () => {
  const target = resolveSftpTransferNavigationTarget({
    direction: "upload",
    targetHostId: "host-2",
    sourceConnectionId: "local",
    targetConnectionId: "conn-remote",
    sourcePath: "/Users/me/file.txt",
    targetPath: "/tmp/file.txt",
    isDirectory: false,
  }, true);

  assert.deepEqual(target, {
    kind: "remote-host",
    hostId: "host-2",
    useSourcePath: false,
  });
});

test("resume of a local copy only opens the SFTP panel", () => {
  const target = resolveSftpTransferNavigationTarget({
    direction: "local-copy",
    sourceConnectionId: "local",
    targetConnectionId: "local",
    sourcePath: "/Users/me/a.txt",
    targetPath: "/Users/me/b.txt",
    isDirectory: false,
  }, true);

  assert.deepEqual(target, {
    kind: "local-copy-panel",
    useSourcePath: false,
  });
});

test("opening an upload destination uses the remote target (never local openPath)", () => {
  const withHostId = resolveSftpTransferNavigationTarget({
    direction: "upload",
    targetHostId: "host-2",
    sourceConnectionId: "local",
    targetConnectionId: "conn-remote",
    sourcePath: "/Users/me/file.txt",
    targetPath: "/root/file.txt",
    isDirectory: false,
  }, false);
  assert.deepEqual(withHostId, {
    kind: "remote-host",
    hostId: "host-2",
    useSourcePath: false,
  });

  // Older / drag-drop rows may lack targetHostId — still open remote, not /root via shell.
  const withoutHostId = resolveSftpTransferNavigationTarget({
    direction: "upload",
    sourceConnectionId: "local",
    targetConnectionId: "conn-remote",
    sourcePath: "/Users/me/file.txt",
    targetPath: "/root/file.txt",
    isDirectory: false,
  }, false);
  assert.deepEqual(withoutHostId, {
    kind: "remote-host",
    hostId: undefined,
    useSourcePath: false,
  });
});

test("navigation host label prefers the endpoint being opened", () => {
  assert.equal(
    resolveSftpTransferNavigationHostLabel({
      sourceHostLabel: "Local",
      targetHostLabel: "CI-Build-01",
    }, false),
    "CI-Build-01",
  );
  assert.equal(
    resolveSftpTransferNavigationHostLabel({
      sourceHostLabel: "prod",
      targetHostLabel: "Local",
    }, true),
    "prod",
  );
});

test("pickHostForTransferNavigation falls back to live SFTP host for uploads", () => {
  const live = { id: "host-live", label: "CI-Build-01", hostname: "10.0.0.1" };
  assert.equal(
    pickHostForTransferNavigation({
      hostId: undefined,
      hostLabel: undefined,
      vaultHosts: [{ id: "other", label: "other" }],
      liveHosts: [live],
      allowLiveUploadFallback: true,
    }),
    live,
  );
  assert.equal(
    pickHostForTransferNavigation({
      hostId: "host-vault",
      hostLabel: "CI-Build-01",
      vaultHosts: [{ id: "host-vault", label: "CI-Build-01" }],
      liveHosts: [live],
    })?.id,
    "host-vault",
  );
});

test("isTransferNavigationTerminalTabId rejects vault/editor scopes", () => {
  assert.equal(isTransferNavigationTerminalTabId(null), false);
  assert.equal(isTransferNavigationTerminalTabId("vault"), false);
  assert.equal(isTransferNavigationTerminalTabId("sftp"), false);
  assert.equal(isTransferNavigationTerminalTabId("editor:abc"), false);
  assert.equal(isTransferNavigationTerminalTabId("session-uuid"), true);
  assert.equal(isTransferNavigationTerminalTabId("workspace-1"), true);
});
