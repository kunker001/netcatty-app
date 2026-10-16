const test = require("node:test");
const assert = require("node:assert/strict");

const {
  sanitizeNodeOptionsForElectron,
  applyElectronLaunchEnv,
} = require("./launchEnv.cjs");

test("sanitizeNodeOptionsForElectron strips --openssl-legacy-provider", () => {
  assert.equal(
    sanitizeNodeOptionsForElectron("--openssl-legacy-provider"),
    undefined,
  );
  assert.equal(
    sanitizeNodeOptionsForElectron("--openssl-legacy-provider --disable-warning=DEP0190"),
    "--disable-warning=DEP0190",
  );
  assert.equal(
    sanitizeNodeOptionsForElectron("--disable-warning=DEP0190"),
    "--disable-warning=DEP0190",
  );
  assert.equal(sanitizeNodeOptionsForElectron(""), undefined);
  assert.equal(sanitizeNodeOptionsForElectron(undefined), undefined);
});

test("applyElectronLaunchEnv clears ELECTRON_RUN_AS_NODE and openssl flag", () => {
  const env = applyElectronLaunchEnv({
    PATH: "/usr/bin",
    ELECTRON_RUN_AS_NODE: "1",
    NODE_OPTIONS: "--openssl-legacy-provider --trace-warnings",
  });
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(env.NODE_OPTIONS, "--trace-warnings");
  assert.equal(env.PATH, "/usr/bin");
});
