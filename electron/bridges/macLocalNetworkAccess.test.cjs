"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  DEFAULT_PROBE_TIMEOUT_MS,
  DEFAULT_PROBE_HOLD_MS,
  DISCARD_PORT,
  isLocalNetworkHostname,
  isLocalMdnsName,
  resolveFirstTcpEndpoint,
  resolveLanProbeTarget,
  annotateMacLocalNetworkErrorMessage,
  attachMacLocalNetworkProbeResult,
  createMacLocalNetworkAccessGate,
} = require("./macLocalNetworkAccess.cjs");

test("DEFAULT_PROBE_TIMEOUT_MS is a few seconds, not tens of seconds", () => {
  assert.ok(DEFAULT_PROBE_TIMEOUT_MS >= 500);
  assert.ok(DEFAULT_PROBE_TIMEOUT_MS <= 5_000);
  const gate = createMacLocalNetworkAccessGate({
    platform: "darwin",
    forceElectron: true,
  });
  assert.equal(gate.getProbeTimeoutMs(), DEFAULT_PROBE_TIMEOUT_MS);
});

test("DEFAULT_PROBE_HOLD_MS keeps the UDP socket open briefly for TCC", () => {
  assert.ok(DEFAULT_PROBE_HOLD_MS >= 200);
  assert.ok(DEFAULT_PROBE_HOLD_MS <= 2_000);
});

test("DISCARD_PORT is the IANA discard service used by Apple TN3179", () => {
  assert.equal(DISCARD_PORT, 9);
});

test("isLocalNetworkHostname recognizes RFC1918, link-local, and CGNAT", () => {
  assert.equal(isLocalNetworkHostname("192.168.5.22"), true);
  assert.equal(isLocalNetworkHostname("10.0.0.1"), true);
  assert.equal(isLocalNetworkHostname("172.16.9.1"), true);
  assert.equal(isLocalNetworkHostname("172.31.255.1"), true);
  assert.equal(isLocalNetworkHostname("169.254.1.1"), true);
  assert.equal(isLocalNetworkHostname("100.64.0.1"), true);
  assert.equal(isLocalNetworkHostname("[fd12::1]"), true);
  assert.equal(isLocalNetworkHostname("fe80::1"), true);
  assert.equal(isLocalNetworkHostname("::ffff:192.168.1.9"), true);
});

test("isLocalNetworkHostname rejects public, loopback, empty, and non-IP hostnames", () => {
  assert.equal(isLocalNetworkHostname("8.8.8.8"), false);
  assert.equal(isLocalNetworkHostname("1.1.1.1"), false);
  assert.equal(isLocalNetworkHostname("172.15.0.1"), false);
  assert.equal(isLocalNetworkHostname("172.32.0.1"), false);
  assert.equal(isLocalNetworkHostname("127.0.0.1"), false);
  assert.equal(isLocalNetworkHostname("localhost"), false);
  assert.equal(isLocalNetworkHostname("example.com"), false);
  assert.equal(isLocalNetworkHostname("nas.local"), false);
  // Must not treat public names that merely start with fc/fd as ULA.
  assert.equal(isLocalNetworkHostname("fda.gov"), false);
  assert.equal(isLocalNetworkHostname("fdcorp.example"), false);
  assert.equal(isLocalNetworkHostname("fc-host.example"), false);
  assert.equal(isLocalNetworkHostname(""), false);
  assert.equal(isLocalNetworkHostname(null), false);
});

test("isLocalMdnsName recognizes .local hostnames that require Local Network access", () => {
  assert.equal(isLocalMdnsName("nas.local"), true);
  assert.equal(isLocalMdnsName("NAS.LOCAL."), true);
  assert.equal(isLocalMdnsName("printer.local"), true);
  assert.equal(isLocalMdnsName("example.com"), false);
  assert.equal(isLocalMdnsName("192.168.1.1"), false);
  assert.equal(isLocalMdnsName("localhost"), false);
  assert.equal(isLocalMdnsName(""), false);
});

test("resolveFirstTcpEndpoint prefers proxy, then jump host, then target", () => {
  assert.deepEqual(
    resolveFirstTcpEndpoint({
      hostname: "10.0.0.9",
      port: 2222,
      proxy: { type: "socks5", host: "192.168.0.2", port: 1080 },
      jumpHosts: [{ hostname: "192.168.1.1", port: 2200 }],
    }),
    { hostname: "192.168.0.2", port: 1080 },
  );
  assert.deepEqual(
    resolveFirstTcpEndpoint({
      hostname: "10.0.0.9",
      port: 2222,
      jumpHosts: [{ hostname: "192.168.1.1", port: 2200 }],
    }),
    { hostname: "192.168.1.1", port: 2200 },
  );
  assert.deepEqual(
    resolveFirstTcpEndpoint({ hostname: "192.168.5.22", port: 22 }),
    { hostname: "192.168.5.22", port: 22 },
  );
  assert.deepEqual(
    resolveFirstTcpEndpoint({ host: "10.1.2.3" }),
    { hostname: "10.1.2.3", port: 22 },
  );
});

test("resolveFirstTcpEndpoint prefers the first jump proxy over session proxy and jump host", () => {
  assert.deepEqual(
    resolveFirstTcpEndpoint({
      hostname: "10.0.0.9",
      port: 22,
      proxy: { type: "socks5", host: "203.0.113.10", port: 1080 },
      jumpHosts: [{
        hostname: "nas.local",
        port: 22,
        proxy: { type: "http", host: "192.168.0.50", port: 8080 },
      }],
    }),
    { hostname: "192.168.0.50", port: 8080 },
  );
  // Active ProxyCommand is terminal: do not fall through to LAN hostnames.
  assert.deepEqual(
    resolveFirstTcpEndpoint({
      hostname: "nas.local",
      proxy: { type: "command", command: "nc -X connect" },
    }),
    { hostname: "", port: 0, skipProbe: true, reason: "command-proxy" },
  );
  assert.deepEqual(
    resolveFirstTcpEndpoint({
      hostname: "10.0.0.9",
      proxy: { type: "socks5", host: "192.168.0.2", port: 1080 },
      jumpHosts: [{
        hostname: "nas.local",
        proxy: { type: "command", command: "nc -X connect" },
      }],
    }),
    { hostname: "", port: 0, skipProbe: true, reason: "command-proxy" },
  );
});

test("createMacLocalNetworkAccessGate skips probing when ProxyCommand owns the first hop", async () => {
  let creates = 0;
  const gate = createMacLocalNetworkAccessGate({
    platform: "darwin",
    forceElectron: true,
    dgram: {
      createSocket() {
        creates += 1;
        throw new Error("must not probe past ProxyCommand");
      },
    },
  });
  const result = await gate.ensureAccess({
    hostname: "nas.local",
    port: 22,
    proxy: { type: "command", command: "cloudflared access ssh" },
  });
  assert.deepEqual(result, { skipped: true, reason: "command-proxy" });
  assert.equal(creates, 0);
});

test("createMacLocalNetworkAccessGate shares one deadline across DNS and UDP probe", async () => {
  const safetyTimeouts = [];
  let now = 5_000;
  const gate = createMacLocalNetworkAccessGate({
    platform: "darwin",
    forceElectron: true,
    probeTimeoutMs: 500,
    probeHoldMs: 5,
    setTimer: (fn, ms) => {
      safetyTimeouts.push(ms);
      // DNS success clears its timer; only fire later UDP hang timers.
      if (safetyTimeouts.length > 1) queueMicrotask(fn);
      return { ms };
    },
    clearTimer() {},
    lookup: async () => {
      now += 200;
      return [{ address: "192.168.7.37", family: 4 }];
    },
    dgram: {
      createSocket() {
        class HangSocket extends EventEmitter {
          connect() {}
          close() {}
        }
        return new HangSocket();
      },
    },
  });

  const originalNow = Date.now;
  Date.now = () => now;
  try {
    await gate.ensureAccess({ hostname: "dev-viet", port: 22 });
  } finally {
    Date.now = originalNow;
  }

  // DNS armed with the full budget; UDP families inherit only the remainder.
  assert.ok(safetyTimeouts.includes(500), `expected DNS budget arm, got ${JSON.stringify(safetyTimeouts)}`);
  const udpBudgets = safetyTimeouts.filter((ms) => ms !== 500);
  assert.ok(udpBudgets.length >= 1, `expected UDP budget arm(s), got ${JSON.stringify(safetyTimeouts)}`);
  assert.ok(udpBudgets.every((ms) => ms <= 300), `UDP budgets should be residual, got ${JSON.stringify(udpBudgets)}`);
});

test("resolveLanProbeTarget keeps LAN literals and .local names", async () => {
  assert.deepEqual(
    await resolveLanProbeTarget("192.168.7.37"),
    { hostname: "192.168.7.37", reason: "literal" },
  );
  assert.deepEqual(
    await resolveLanProbeTarget("dev-viet.local"),
    { hostname: "dev-viet.local", reason: "mdns" },
  );
});

test("resolveLanProbeTarget DNS-resolves hostnames and picks a LAN address", async () => {
  const target = await resolveLanProbeTarget("dev-viet", {
    lookup: async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "192.168.7.37", family: 4 },
    ],
  });
  assert.deepEqual(target, { hostname: "192.168.7.37", reason: "resolved" });
});

test("resolveLanProbeTarget returns null for public-only hostnames", async () => {
  const target = await resolveLanProbeTarget("example.com", {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  assert.equal(target, null);
});

test("annotateMacLocalNetworkErrorMessage only rewrites LAN unreachability on darwin", () => {
  const base = "connect EHOSTUNREACH 192.168.5.22:22";
  const annotated = annotateMacLocalNetworkErrorMessage(base, {
    platform: "darwin",
    hostname: "192.168.5.22",
  });
  assert.match(annotated, /Local Network/i);
  assert.match(annotated, /System Settings/i);
  assert.equal(
    annotateMacLocalNetworkErrorMessage(base, {
      platform: "linux",
      hostname: "192.168.5.22",
    }),
    base,
  );
  // Message embeds a LAN IP - annotate even when the vault hostname option is public.
  assert.match(
    annotateMacLocalNetworkErrorMessage(base, {
      platform: "darwin",
      hostname: "8.8.8.8",
    }),
    /Local Network/i,
  );
  assert.equal(
    annotateMacLocalNetworkErrorMessage(
      "connect EHOSTUNREACH 8.8.8.8:22",
      { platform: "darwin", hostname: "8.8.8.8" },
    ),
    "connect EHOSTUNREACH 8.8.8.8:22",
  );
  assert.equal(
    annotateMacLocalNetworkErrorMessage("All configured authentication methods failed", {
      platform: "darwin",
      hostname: "192.168.5.22",
    }),
    "All configured authentication methods failed",
  );
  // Annotate when first hop is LAN even if final target is public.
  const viaJump = annotateMacLocalNetworkErrorMessage(base, {
    platform: "darwin",
    hostname: "8.8.8.8",
    firstHopHostname: "192.168.1.1",
  });
  assert.match(viaJump, /Local Network/i);
});

test("annotateMacLocalNetworkErrorMessage detects LAN IPs embedded in the error text", () => {
  const message = "Error: connect EHOSTUNREACH 192.168.7.37:22 - Local (192.168.6.131:58210)";
  const annotated = annotateMacLocalNetworkErrorMessage(message, {
    platform: "darwin",
    // Vault host stored as a DNS name, not a literal IP.
    hostname: "dev-viet",
  });
  assert.match(annotated, /Local Network/i);
});

test("annotateMacLocalNetworkErrorMessage ignores LAN bind addresses on public failures", () => {
  const message = "connect EHOSTUNREACH 93.184.216.34:22 - Local (192.168.1.5:58210)";
  assert.equal(
    annotateMacLocalNetworkErrorMessage(message, {
      platform: "darwin",
      hostname: "example.com",
    }),
    message,
  );
});

test("annotateMacLocalNetworkErrorMessage detects embedded IPv6 LAN destinations", () => {
  const bracketed = "connect EHOSTUNREACH [fd12::1]:22";
  assert.match(
    annotateMacLocalNetworkErrorMessage(bracketed, {
      platform: "darwin",
      hostname: "ula-host",
    }),
    /Local Network/i,
  );
  const bare = "connect EHOSTUNREACH fe80::1:22 - Local ([fe80::abcd]:5555)";
  assert.match(
    annotateMacLocalNetworkErrorMessage(bare, {
      platform: "darwin",
      hostname: "link-local-host",
    }),
    /Local Network/i,
  );
});

test("annotateMacLocalNetworkErrorMessage ignores .local targets behind a public first hop", () => {
  const message = "connect EHOSTUNREACH 93.184.216.34:1080";
  assert.equal(
    annotateMacLocalNetworkErrorMessage(message, {
      platform: "darwin",
      hostname: "nas.local",
      firstHopHostname: "93.184.216.34",
    }),
    message,
  );
  assert.match(
    annotateMacLocalNetworkErrorMessage(message, {
      platform: "darwin",
      hostname: "nas.local",
      firstHopHostname: "nas.local",
    }),
    /Local Network/i,
  );
});

test("annotateMacLocalNetworkErrorMessage ignores downstream LAN addresses behind a public first hop", () => {
  const message = "connect EHOSTUNREACH 192.168.1.10:22";
  assert.equal(
    annotateMacLocalNetworkErrorMessage(message, {
      platform: "darwin",
      hostname: "nas.local",
      firstHopHostname: "proxy.example.com",
    }),
    message,
  );
  assert.equal(
    annotateMacLocalNetworkErrorMessage(message, {
      platform: "darwin",
      hostname: "192.168.1.10",
      firstHopHostname: "93.184.216.34",
    }),
    message,
  );
});

test("annotateMacLocalNetworkErrorMessage keeps LAN guidance for hostname-based LAN first hops", () => {
  const message = "connect EHOSTUNREACH 192.168.1.20:22";
  assert.match(
    annotateMacLocalNetworkErrorMessage(message, {
      platform: "darwin",
      hostname: "app.internal",
      firstHopHostname: "bastion.lan",
    }),
    /Local Network/i,
  );
});

test("annotateMacLocalNetworkErrorMessage keeps LAN guidance for unqualified first hops", () => {
  const message = "connect EHOSTUNREACH 192.168.7.37:22";
  assert.match(
    annotateMacLocalNetworkErrorMessage(message, {
      platform: "darwin",
      hostname: "app.example.com",
      firstHopHostname: "dev-viet",
    }),
    /Local Network/i,
  );
});

test("annotateMacLocalNetworkErrorMessage uses carried resolved first-hop addresses", () => {
  const message = "connect EHOSTUNREACH 192.168.1.20:22";
  assert.match(
    annotateMacLocalNetworkErrorMessage(message, {
      platform: "darwin",
      hostname: "app.example.com",
      firstHopHostname: "bastion.example.com",
      firstHopResolvedAddress: "192.168.1.20",
    }),
    /Local Network/i,
  );
  assert.equal(
    annotateMacLocalNetworkErrorMessage(message, {
      platform: "darwin",
      hostname: "app.example.com",
      firstHopHostname: "bastion.example.com",
    }),
    message,
  );
});

test("attachMacLocalNetworkProbeResult forwards resolved first-hop for direct starts", () => {
  const options = {
    hostname: "app.example.com",
    jumpHosts: [{ hostname: "bastion.example.com", port: 22 }],
  };
  const attached = attachMacLocalNetworkProbeResult(options, {
    probed: true,
    hostname: "192.168.1.20",
  });
  assert.equal(attached._macLocalNetworkResolvedFirstHop, "192.168.1.20");
  assert.match(
    annotateMacLocalNetworkErrorMessage("connect EHOSTUNREACH 192.168.1.20:22", {
      platform: "darwin",
      hostname: attached.hostname,
      firstHopHostname: "bastion.example.com",
      firstHopResolvedAddress: attached._macLocalNetworkResolvedFirstHop,
    }),
    /Local Network/i,
  );
  assert.equal(
    attachMacLocalNetworkProbeResult(options, { skipped: true, reason: "not-local-network" })
      ._macLocalNetworkResolvedFirstHop,
    undefined,
  );
});

test("annotateMacLocalNetworkErrorMessage ignores ProxyCommand errors even with LAN evidence", () => {
  const localName = "Network is unreachable";
  assert.equal(
    annotateMacLocalNetworkErrorMessage(localName, {
      platform: "darwin",
      hostname: "nas.local",
      firstHopHostname: "",
      skipProbe: true,
    }),
    localName,
  );

  const childLan = "connect EHOSTUNREACH 192.168.1.10:22";
  assert.equal(
    annotateMacLocalNetworkErrorMessage(childLan, {
      platform: "darwin",
      hostname: "nas.local",
      firstHopHostname: "",
      skipProbe: true,
    }),
    childLan,
  );
});

function createFakeUdpSocket({ onConnect, onError } = {}) {
  class FakeUdpSocket extends EventEmitter {
    constructor() {
      super();
      this.closed = false;
      this.connectCalls = [];
    }
    connect(port, host, callback) {
      this.connectCalls.push({ port, host });
      queueMicrotask(() => {
        if (onError) {
          this.emit("error", onError);
          return;
        }
        if (typeof callback === "function") callback();
        if (typeof onConnect === "function") onConnect(this);
      });
    }
    close() {
      this.closed = true;
    }
  }
  return new FakeUdpSocket();
}

test("createMacLocalNetworkAccessGate probes with UDP discard once per LAN endpoint", async () => {
  const sockets = [];
  const gate = createMacLocalNetworkAccessGate({
    platform: "darwin",
    forceElectron: true,
    probeHoldMs: 5,
    dgram: {
      createSocket(type) {
        const socket = createFakeUdpSocket();
        socket.type = type;
        sockets.push(socket);
        return socket;
      },
    },
  });

  await gate.ensureAccess({ hostname: "192.168.5.22", port: 22 });
  await gate.ensureAccess({ hostname: "192.168.5.22", port: 22 });
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].type, "udp4");
  assert.deepEqual(sockets[0].connectCalls[0], { port: DISCARD_PORT, host: "192.168.5.22" });
  assert.equal(sockets[0].closed, true);
});

test("createMacLocalNetworkAccessGate resolves hostnames before probing", async () => {
  const sockets = [];
  const gate = createMacLocalNetworkAccessGate({
    platform: "darwin",
    forceElectron: true,
    probeHoldMs: 5,
    lookup: async () => [{ address: "192.168.7.37", family: 4 }],
    dgram: {
      createSocket() {
        const socket = createFakeUdpSocket();
        sockets.push(socket);
        return socket;
      },
    },
  });

  const result = await gate.ensureAccess({ hostname: "dev-viet", port: 22 });
  assert.equal(result.probed, true);
  assert.equal(result.hostname, "192.168.7.37");
  assert.deepEqual(sockets[0].connectCalls[0], { port: DISCARD_PORT, host: "192.168.7.37" });
});

test("createMacLocalNetworkAccessGate probes .local names without requiring DNS", async () => {
  const sockets = [];
  const gate = createMacLocalNetworkAccessGate({
    platform: "darwin",
    forceElectron: true,
    probeHoldMs: 5,
    lookup: async () => {
      throw new Error("DNS must not be required for .local");
    },
    dgram: {
      createSocket(type) {
        const socket = createFakeUdpSocket();
        socket.type = type;
        sockets.push(socket);
        return socket;
      },
    },
  });

  const result = await gate.ensureAccess({ hostname: "nas.local", port: 22 });
  assert.equal(result.probed, true);
  assert.deepEqual(sockets[0].connectCalls[0], { port: DISCARD_PORT, host: "nas.local" });
  assert.equal(sockets[0].type, "udp4");
});

test("createMacLocalNetworkAccessGate retries .local probes over udp6 when udp4 fails", async () => {
  const sockets = [];
  const gate = createMacLocalNetworkAccessGate({
    platform: "darwin",
    forceElectron: true,
    probeHoldMs: 5,
    dgram: {
      createSocket(type) {
        const socket = createFakeUdpSocket(
          type === "udp4"
            ? { onError: Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }) }
            : undefined,
        );
        socket.type = type;
        sockets.push(socket);
        return socket;
      },
    },
  });

  const result = await gate.ensureAccess({ hostname: "ipv6-only.local", port: 22 });
  assert.equal(result.probed, true);
  assert.deepEqual(sockets.map((socket) => socket.type), ["udp4", "udp6"]);
  assert.deepEqual(sockets[1].connectCalls[0], { port: DISCARD_PORT, host: "ipv6-only.local" });
  assert.equal(sockets[1].closed, true);
});

test("createMacLocalNetworkAccessGate shares one timeout across udp4 and udp6 fallbacks", async () => {
  const safetyTimeouts = [];
  let now = 1_000;
  const gate = createMacLocalNetworkAccessGate({
    platform: "darwin",
    forceElectron: true,
    probeTimeoutMs: 500,
    probeHoldMs: 5,
    setTimer: (fn, ms) => {
      safetyTimeouts.push(ms);
      // First family burns its reserved slice before failing.
      if (safetyTimeouts.length === 1) now += ms;
      queueMicrotask(fn);
      return { ms };
    },
    clearTimer() {},
    dgram: {
      createSocket() {
        class HangSocket extends EventEmitter {
          connect() {
            // Never connects; each family burns part of the shared budget.
          }
          close() {}
        }
        return new HangSocket();
      },
    },
  });

  const originalNow = Date.now;
  Date.now = () => now;
  try {
    await gate.ensureAccess({ hostname: "hang.local", port: 22 });
  } finally {
    Date.now = originalNow;
  }

  assert.equal(safetyTimeouts.length, 2);
  // Budget is split so udp6 always gets an attempt.
  assert.equal(safetyTimeouts[0], 250);
  assert.equal(safetyTimeouts[1], 250);
});

test("createMacLocalNetworkAccessGate skips non-darwin and non-LAN hosts", async () => {
  let creates = 0;
  const linuxGate = createMacLocalNetworkAccessGate({
    platform: "linux",
    forceElectron: true,
    dgram: {
      createSocket() {
        creates += 1;
        throw new Error("should not create socket");
      },
    },
  });
  await linuxGate.ensureAccess({ hostname: "192.168.5.22", port: 22 });

  const darwinGate = createMacLocalNetworkAccessGate({
    platform: "darwin",
    forceElectron: true,
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    dgram: {
      createSocket() {
        creates += 1;
        throw new Error("should not create socket");
      },
    },
  });
  await darwinGate.ensureAccess({ hostname: "example.com", port: 22 });
  await darwinGate.ensureAccess({ hostname: "fda.gov", port: 22 });

  const bareNodeGate = createMacLocalNetworkAccessGate({
    platform: "darwin",
    versions: {},
    dgram: {
      createSocket() {
        creates += 1;
        throw new Error("should not create socket outside Electron");
      },
    },
  });
  await bareNodeGate.ensureAccess({ hostname: "192.168.5.22", port: 22 });
  assert.equal(creates, 0);
});

test("createMacLocalNetworkAccessGate treats UDP errors as a completed probe", async () => {
  const gate = createMacLocalNetworkAccessGate({
    platform: "darwin",
    forceElectron: true,
    probeHoldMs: 5,
    dgram: {
      createSocket() {
        return createFakeUdpSocket({
          onError: Object.assign(new Error("connect EHOSTUNREACH"), { code: "EHOSTUNREACH" }),
        });
      },
    },
  });
  await gate.ensureAccess({
    hostname: "10.0.0.8",
    port: 22,
    jumpHosts: [{ hostname: "192.168.1.50", port: 2200 }],
  });
  // Second call must be cached even though the first connect failed.
  let secondCreates = 0;
  const cachedGate = createMacLocalNetworkAccessGate({
    platform: "darwin",
    forceElectron: true,
    probedKeys: new Set(["192.168.1.50"]),
    dgram: {
      createSocket() {
        secondCreates += 1;
        throw new Error("should use cache");
      },
    },
  });
  await cachedGate.ensureAccess({
    jumpHosts: [{ hostname: "192.168.1.50", port: 2200 }],
  });
  assert.equal(secondCreates, 0);
});

test("createMacLocalNetworkAccessGate holds the UDP socket before closing", async () => {
  const holds = [];
  let resolveConnect;
  const connectSeen = new Promise((resolve) => {
    resolveConnect = resolve;
  });
  const gate = createMacLocalNetworkAccessGate({
    platform: "darwin",
    forceElectron: true,
    probeHoldMs: 25,
    setTimer: (fn, ms) => {
      holds.push(ms);
      return setTimeout(fn, ms);
    },
    clearTimer: clearTimeout,
    dgram: {
      createSocket() {
        return createFakeUdpSocket({
          onConnect(socket) {
            resolveConnect(socket);
          },
        });
      },
    },
  });
  const pending = gate.ensureAccess({ hostname: "10.0.0.1", port: 22 });
  const socket = await connectSeen;
  assert.equal(socket.closed, false);
  await pending;
  assert.ok(holds.includes(25), `expected hold timer 25ms, got ${JSON.stringify(holds)}`);
  assert.equal(socket.closed, true);
});

test("createMacLocalNetworkAccessGate applies the configured probe timeout as a safety net", async () => {
  const timeouts = [];
  const holdMs = 5;
  const gate = createMacLocalNetworkAccessGate({
    platform: "darwin",
    forceElectron: true,
    probeTimeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
    probeHoldMs: holdMs,
    setTimer: (fn, ms) => {
      timeouts.push(ms);
      // Shared-deadline math often arms a residual (e.g. 2999) rather than the
      // exact constant. Fire any safety-budget timer; the hang socket never connects.
      if (ms > holdMs) queueMicrotask(fn);
      return { ms };
    },
    clearTimer() {},
    dgram: {
      createSocket() {
        class HangSocket extends EventEmitter {
          connect() {
            // Never connects; safety timeout must finish the probe.
          }
          close() {}
        }
        return new HangSocket();
      },
    },
  });
  await gate.ensureAccess({ hostname: "10.0.0.1", port: 22 });
  const safetyTimeouts = timeouts.filter((ms) => ms > holdMs);
  assert.equal(safetyTimeouts.length, 1);
  assert.ok(
    safetyTimeouts[0] >= DEFAULT_PROBE_TIMEOUT_MS - 50
      && safetyTimeouts[0] <= DEFAULT_PROBE_TIMEOUT_MS,
    `expected residual safety budget near ${DEFAULT_PROBE_TIMEOUT_MS}, got ${safetyTimeouts[0]}`
  );
});

test("createMacLocalNetworkAccessGate clears the safety timer so the full hold runs after a slow connect", async () => {
  const cleared = [];
  const holds = [];
  const safetyHandles = [];
  const safetyMs = 500;
  const holdMs = 40;
  let resolveConnectReady;
  const connectReady = new Promise((resolve) => {
    resolveConnectReady = resolve;
  });
  const gate = createMacLocalNetworkAccessGate({
    platform: "darwin",
    forceElectron: true,
    probeTimeoutMs: safetyMs,
    probeHoldMs: holdMs,
    setTimer: (fn, ms) => {
      const handle = { ms, fn, cleared: false };
      if (ms === holdMs) {
        holds.push(ms);
        queueMicrotask(fn);
      } else if (ms > holdMs) {
        // Connect budget may be a residual (e.g. 499) after shared-deadline math.
        safetyHandles.push(handle);
      }
      return handle;
    },
    clearTimer(handle) {
      if (handle && typeof handle === "object") {
        handle.cleared = true;
        cleared.push(handle.ms);
      }
    },
    dgram: {
      createSocket() {
        class SlowSocket extends EventEmitter {
          connect(_port, _host, callback) {
            resolveConnectReady(callback);
          }
          close() {}
        }
        return new SlowSocket();
      },
    },
  });

  const pending = gate.ensureAccess({ hostname: "192.168.1.10", port: 22 });
  const connectCallback = await connectReady;
  // Simulate connect completing late in the safety window.
  assert.equal(typeof connectCallback, "function");
  assert.equal(safetyHandles.length, 1);
  assert.ok(
    safetyHandles[0].ms <= safetyMs && safetyHandles[0].ms >= safetyMs - 50,
    `unexpected safety budget ${safetyHandles[0].ms}`,
  );
  connectCallback();
  await pending;

  assert.equal(safetyHandles[0].cleared, true);
  assert.ok(
    cleared.includes(safetyHandles[0].ms),
    `safety timer should be cleared on connect, cleared=${JSON.stringify(cleared)}`,
  );
  assert.deepEqual(holds, [holdMs]);
});

test("createMacLocalNetworkAccessGate skips when main process already probed", async () => {
  let creates = 0;
  const gate = createMacLocalNetworkAccessGate({
    platform: "darwin",
    forceElectron: true,
    dgram: {
      createSocket() {
        creates += 1;
        throw new Error("worker must not probe after main");
      },
    },
  });
  const result = await gate.ensureAccess({
    hostname: "192.168.5.22",
    port: 22,
    _macLocalNetworkMainProbed: true,
  });
  assert.deepEqual(result, { skipped: true, reason: "main-probed" });
  assert.equal(creates, 0);
});

test("createMacLocalNetworkAccessGate bounds hostname DNS lookup by the probe timeout", async () => {
  let creates = 0;
  const timeouts = [];
  const gate = createMacLocalNetworkAccessGate({
    platform: "darwin",
    forceElectron: true,
    probeTimeoutMs: 500,
    probeHoldMs: 5,
    setTimer: (fn, ms) => {
      timeouts.push(ms);
      queueMicrotask(fn);
      return { ms };
    },
    clearTimer() {},
    lookup: () => new Promise(() => {
      // Never resolves - must be aborted by the probe timeout budget.
    }),
    dgram: {
      createSocket() {
        creates += 1;
        throw new Error("must not probe after DNS timeout");
      },
    },
  });

  const result = await gate.ensureAccess({ hostname: "slow-dns.example", port: 22 });

  assert.deepEqual(result, { skipped: true, reason: "not-local-network" });
  assert.equal(creates, 0);
  assert.ok(timeouts.includes(500), `expected DNS timeout arm, got ${JSON.stringify(timeouts)}`);
});

test("createMacLocalNetworkAccessGate carries resolved first-hop addresses into annotation", async () => {
  const gate = createMacLocalNetworkAccessGate({
    platform: "darwin",
    forceElectron: true,
    probeHoldMs: 0,
    lookup: async () => ({ address: "192.168.1.20", family: 4 }),
    dgram: {
      createSocket() {
        return createFakeUdpSocket();
      },
    },
  });
  const probe = await gate.ensureAccess({
    jumpHosts: [{ hostname: "bastion.example.com", port: 22 }],
  });
  assert.equal(probe.hostname, "192.168.1.20");
  assert.equal(gate.getResolvedFirstHop("bastion.example.com"), "192.168.1.20");
  assert.match(
    gate.annotateErrorMessage("connect EHOSTUNREACH 192.168.1.20:22", {
      hostname: "app.example.com",
      jumpHosts: [{ hostname: "bastion.example.com", port: 22 }],
    }),
    /Local Network/i,
  );
});
