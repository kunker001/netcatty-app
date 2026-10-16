const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  _appendSshDiagnosticLog,
  _createSshDiagnosticLogger,
  _getSshDebugLogFilePath,
  _setSshDebugLoggingEnabled,
  _shouldLogSshDebugMessage,
} = require("./sshBridge.cjs");

test("SSH debug logging keeps handshake and key exchange messages", () => {
  assert.equal(
    _shouldLogSshDebugMessage("Handshake: KEX algorithm: diffie-hellman-group-exchange-sha1"),
    true,
  );
  assert.equal(
    _shouldLogSshDebugMessage("Handshake: (remote) KEX method: diffie-hellman-group14-sha1"),
    true,
  );
  assert.equal(
    _shouldLogSshDebugMessage("Outbound: Sending KEXDH_GEX_REQUEST"),
    true,
  );
  assert.equal(
    _shouldLogSshDebugMessage("Received DH GEX Group"),
    true,
  );
  assert.equal(
    _shouldLogSshDebugMessage("Outbound: Sending NEWKEYS"),
    true,
  );
});

test("SSH debug logging keeps auth messages but drops noisy channel data", () => {
  assert.equal(
    _shouldLogSshDebugMessage("Outbound: Sending USERAUTH_REQUEST (publickey -- check)"),
    true,
  );
  assert.equal(
    _shouldLogSshDebugMessage("Inbound: Received CHANNEL_DATA"),
    false,
  );
  assert.equal(
    _shouldLogSshDebugMessage("Outbound: Sending CHANNEL_WINDOW_ADJUST"),
    false,
  );
});

test("SSH diagnostic log defaults to Netcatty's managed temp directory", () => {
  const logPath = _getSshDebugLogFilePath();
  assert.equal(path.basename(path.dirname(logPath)), "Netcatty");
  assert.match(path.basename(logPath), /netcatty-ssh\.log$/);
});

test("SSH diagnostic logging can be enabled at runtime and writes safe connection events", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-ssh-debug-"));
  const logPath = path.join(tempRoot, "ssh-debug.log");

  try {
    _setSshDebugLoggingEnabled(false, { logFilePath: logPath });
    _appendSshDiagnosticLog("connection closed", {
      hostname: "10.1.38.1",
      username: "alice",
      password: "secret",
      privateKey: "-----BEGIN PRIVATE KEY-----",
      reason: "closed",
    });
    assert.equal(fs.existsSync(logPath), false);

    _setSshDebugLoggingEnabled(true, { logFilePath: logPath });
    assert.equal(_getSshDebugLogFilePath(), logPath);

    _appendSshDiagnosticLog("connection closed", {
      hostname: "10.1.38.1",
      username: "alice",
      password: "secret",
      privateKey: "-----BEGIN PRIVATE KEY-----",
      reason: "closed",
    });

    const contents = fs.readFileSync(logPath, "utf8");
    assert.match(contents, /connection closed/);
    assert.match(contents, /10\.1\.38\.1/);
    assert.match(contents, /"reason":"closed"/);
    assert.doesNotMatch(contents, /secret/);
    assert.doesNotMatch(contents, /PRIVATE KEY/);
  } finally {
    _setSshDebugLoggingEnabled(false);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("SSH diagnostic logger keeps each session's enabled state isolated", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-ssh-debug-"));
  const logPath = path.join(tempRoot, "ssh-debug.log");

  try {
    _setSshDebugLoggingEnabled(false, { logFilePath: logPath });
    const enabledLogger = _createSshDiagnosticLogger(true);
    const disabledLogger = _createSshDiagnosticLogger(false);

    disabledLogger("disabled session closed", { hostname: "10.1.38.2" });
    enabledLogger("enabled session closed", { hostname: "10.1.38.1" });
    disabledLogger("disabled session error", { hostname: "10.1.38.3" });

    const contents = fs.readFileSync(logPath, "utf8");
    assert.match(contents, /enabled session closed/);
    assert.match(contents, /10\.1\.38\.1/);
    assert.doesNotMatch(contents, /disabled session/);
    assert.doesNotMatch(contents, /10\.1\.38\.2/);
    assert.doesNotMatch(contents, /10\.1\.38\.3/);
  } finally {
    _setSshDebugLoggingEnabled(false);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
