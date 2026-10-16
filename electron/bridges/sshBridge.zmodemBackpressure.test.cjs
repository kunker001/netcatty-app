"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

test("SSH ZMODEM uploads wire stream backpressure to a real drain wait", () => {
  const bridgeSource = fs.readFileSync(require.resolve("./sshBridge.cjs"), "utf8");
  const zmodemSource = fs.readFileSync(require.resolve("./zmodemHelper.cjs"), "utf8");
  const startSessionSource = fs.readFileSync(
    require.resolve("./sshBridge/startSession.cjs"),
    "utf8",
  );

  assert.match(
    bridgeSource,
    /createZmodemSentry,\s*waitForWritableDrain/,
    "sshBridge must pass the shared drain helper into the SSH session factory",
  );
  assert.match(
    startSessionSource,
    /waitForTransportDrain\(drainOpts = {}\)[\s\S]*?waitForWritableDrain\(stream, {[\s\S]*?progressIntervalMs: 1000[\s\S]*?stream\._chunk\?\.length/,
    "SSH ZMODEM must count partial ssh2 channel-window delivery as progress",
  );
  assert.match(
    zmodemSource,
    /For all other errors[\s\S]*?transferAbortController\?\.abort\(\)[\s\S]*?currentZSession = null/,
    "a sentry protocol error must wake an upload blocked on SSH drain",
  );
});
