const test = require("node:test");
const assert = require("node:assert/strict");

const {
  proxyInfoFromResolveResult,
  createAgentFromProxyUrl,
  applyInsecureTargetTls,
} = require("./httpNetworkProxyAgent.cjs");

test("proxyInfoFromResolveResult parses Chromium PROXY / SOCKS / DIRECT", () => {
  assert.equal(proxyInfoFromResolveResult("DIRECT"), null);
  assert.equal(proxyInfoFromResolveResult("PROXY 127.0.0.1:7890"), "http://127.0.0.1:7890");
  assert.equal(proxyInfoFromResolveResult("HTTPS proxy.example:8443"), "https://proxy.example:8443");
  assert.equal(proxyInfoFromResolveResult("SOCKS5 127.0.0.1:1080"), "socks5://127.0.0.1:1080");
  assert.equal(
    proxyInfoFromResolveResult("PROXY 10.0.0.1:8080; DIRECT"),
    "http://10.0.0.1:8080",
  );
});

test("createAgentFromProxyUrl builds http(s) and socks agents", () => {
  const httpsAgent = createAgentFromProxyUrl("http://127.0.0.1:7890", true);
  assert.ok(httpsAgent);
  assert.match(httpsAgent.constructor.name, /ProxyAgent/);

  const httpAgent = createAgentFromProxyUrl("http://127.0.0.1:7890", false);
  assert.ok(httpAgent);

  const socksAgent = createAgentFromProxyUrl("socks5://127.0.0.1:1080", true);
  assert.ok(socksAgent);
});

test("createAgentFromProxyUrl can disable TLS verification for insecure endpoints", () => {
  const agent = createAgentFromProxyUrl("http://127.0.0.1:7890", true, {
    rejectUnauthorized: false,
  });
  assert.ok(agent);
  // allowInsecure must NOT weaken TLS to the proxy hop itself.
  assert.notEqual(agent.connectOpts?.rejectUnauthorized, false);
  // Wrapper must be installed so target TLS upgrades get rejectUnauthorized:false.
  assert.equal(typeof agent.connect, "function");
  assert.notEqual(agent.connect, Object.getPrototypeOf(agent).connect);

  const httpsProxyAgent = createAgentFromProxyUrl("https://proxy.example:8443", true, {
    rejectUnauthorized: false,
  });
  assert.ok(httpsProxyAgent);
  assert.notEqual(httpsProxyAgent.connectOpts?.rejectUnauthorized, false);
  assert.notEqual(httpsProxyAgent.connect, Object.getPrototypeOf(httpsProxyAgent).connect);
});

test("applyInsecureTargetTls forces rejectUnauthorized on tunneled target connect", () => {
  let seenOpts;
  const fakeAgent = {
    connect(_req, opts) {
      seenOpts = opts;
      return opts;
    },
  };
  applyInsecureTargetTls(fakeAgent);
  fakeAgent.connect({}, { host: "example.com", port: 443, rejectUnauthorized: true });
  assert.equal(seenOpts.rejectUnauthorized, false);
});
