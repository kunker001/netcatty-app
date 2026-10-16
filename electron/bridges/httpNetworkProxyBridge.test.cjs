const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildElectronProxyConfigFromPayload,
  applyNodeProxyEnv,
  normalizeProxySettingsPayload,
} = require("./httpNetworkProxyBridge.cjs");

test("normalizeProxySettingsPayload defaults to system", () => {
  assert.deepEqual(normalizeProxySettingsPayload(undefined), {
    mode: "system",
    url: "",
    bypass: "<local>",
  });
});

test("buildElectronProxyConfigFromPayload maps custom mode", () => {
  assert.deepEqual(
    buildElectronProxyConfigFromPayload({
      mode: "custom",
      url: "http://127.0.0.1:7890",
      bypass: "localhost",
    }),
    {
      mode: "fixed_servers",
      proxyRules: "http://127.0.0.1:7890",
      proxyBypassRules: "localhost",
    },
  );
});

test("applyNodeProxyEnv sets and clears process.env for custom/direct", () => {
  const { resetProxyEnvOwnershipForTests } = require("./httpNetworkProxyBridge.cjs");
  resetProxyEnvOwnershipForTests();

  const env = {
    HTTP_PROXY: "stale",
    HTTPS_PROXY: "stale",
    NO_PROXY: "stale",
    http_proxy: "stale",
    https_proxy: "stale",
    no_proxy: "stale",
  };

  applyNodeProxyEnv(
    { mode: "custom", url: "http://proxy:1", bypass: "a,b" },
    env,
  );
  assert.equal(env.HTTP_PROXY, "http://proxy:1");
  assert.equal(env.HTTPS_PROXY, "http://proxy:1");
  assert.equal(env.NO_PROXY, "a,b");
  assert.equal(env.http_proxy, "http://proxy:1");

  applyNodeProxyEnv({ mode: "direct", url: "", bypass: "<local>" }, env);
  assert.equal(env.HTTP_PROXY, undefined);
  assert.equal(env.HTTPS_PROXY, undefined);
  assert.equal(env.NO_PROXY, undefined);
  assert.equal(env.http_proxy, undefined);
});

test("applyNodeProxyEnv restores prior env when returning to system after custom", () => {
  const { resetProxyEnvOwnershipForTests } = require("./httpNetworkProxyBridge.cjs");
  resetProxyEnvOwnershipForTests();

  const env = {
    HTTP_PROXY: "os-proxy",
    HTTPS_PROXY: "os-proxy",
    NO_PROXY: "localhost",
  };

  applyNodeProxyEnv(
    { mode: "custom", url: "http://user:pass@proxy:1", bypass: "a" },
    env,
  );
  // Credentials must not be written into process.env.
  assert.equal(env.HTTP_PROXY, "http://proxy:1");
  assert.equal(env.HTTPS_PROXY, "http://proxy:1");

  applyNodeProxyEnv({ mode: "system", url: "", bypass: "<local>" }, env);
  assert.equal(env.HTTP_PROXY, "os-proxy");
  assert.equal(env.HTTPS_PROXY, "os-proxy");
  assert.equal(env.NO_PROXY, "localhost");
});

test("normalizeProxySettingsPayload strips scheme-less proxy credentials", () => {
  assert.equal(
    normalizeProxySettingsPayload({
      mode: "custom",
      url: "user:secret@proxy.example:8080",
      bypass: "<local>",
    }).url,
    "proxy.example:8080",
  );
});

test("buildTerminalProcessEnv restores launch-time proxy env under direct/custom", () => {
  const {
    applyNodeProxyEnv,
    buildTerminalProcessEnv,
    resetProxyEnvOwnershipForTests,
  } = require("./httpNetworkProxyBridge.cjs");
  resetProxyEnvOwnershipForTests();

  const env = {
    HTTP_PROXY: "launch-proxy",
    HTTPS_PROXY: "launch-proxy",
    NO_PROXY: "localhost",
    PATH: "/usr/bin",
  };

  applyNodeProxyEnv({ mode: "direct", url: "", bypass: "<local>" }, env);
  assert.equal(env.HTTP_PROXY, undefined);

  const terminalEnv = buildTerminalProcessEnv(env);
  assert.equal(terminalEnv.HTTP_PROXY, "launch-proxy");
  assert.equal(terminalEnv.HTTPS_PROXY, "launch-proxy");
  assert.equal(terminalEnv.NO_PROXY, "localhost");
  assert.equal(terminalEnv.PATH, "/usr/bin");
  // App-level process.env remains direct (cleared) for Node HTTP clients.
  assert.equal(env.HTTP_PROXY, undefined);
});

test("empty custom mode applies as system for Electron/env", () => {
  assert.deepEqual(
    buildElectronProxyConfigFromPayload({ mode: "custom", url: "", bypass: "<local>" }),
    { mode: "system" },
  );
});

test("applyHttpNetworkProxy serializes so older setProxy cannot overwrite newer", async () => {
  const {
    applyHttpNetworkProxy,
    getCurrentProxySettings,
    resetProxyEnvOwnershipForTests,
  } = require("./httpNetworkProxyBridge.cjs");
  resetProxyEnvOwnershipForTests();

  const applied = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const session = {
    async setProxy(config) {
      applied.push(config);
      if (applied.length === 1) {
        await firstGate;
      }
    },
  };

  const first = applyHttpNetworkProxy(
    { mode: "custom", url: "http://first:1", bypass: "<local>" },
    { session, env: {} },
  );
  // Let first reach its gate inside setProxy.
  await new Promise((r) => setImmediate(r));
  const second = applyHttpNetworkProxy(
    { mode: "direct", url: "", bypass: "<local>" },
    { session, env: {} },
  );

  releaseFirst();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.superseded, true);
  assert.equal(secondResult.success, true);
  assert.equal(getCurrentProxySettings().mode, "direct");
  assert.deepEqual(applied.at(-1), { mode: "direct" });
});
