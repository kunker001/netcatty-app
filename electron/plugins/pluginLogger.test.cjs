"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { PluginLogger, redactLogValue } = require("./pluginLogger.cjs");

test("plugin logs redact structured secrets and remain bounded on disk", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-plugin-logs-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const logger = new PluginLogger({
    pluginId: "com.example.logger",
    logsDirectory: root,
    maxBytes: 240,
    maxFiles: 2,
  });

  for (let index = 0; index < 8; index += 1) {
    await logger.write("info", `record-${index}`, {
      nested: { apiToken: "must-not-appear", visible: index },
    });
  }
  const files = fs.readdirSync(path.join(root, "com.example.logger"));
  assert.ok(files.length <= 2);
  const contents = files.map((file) => fs.readFileSync(
    path.join(root, "com.example.logger", file),
    "utf8",
  )).join("\n");
  assert.doesNotMatch(contents, /must-not-appear/);
  assert.match(contents, /\[REDACTED\]/);
});

test("log redaction does not invoke accessors", () => {
  const value = {};
  Object.defineProperty(value, "secret", {
    enumerable: true,
    get() { throw new Error("accessor invoked"); },
  });
  assert.deepEqual(redactLogValue(value), { secret: "[REDACTED]" });
});
