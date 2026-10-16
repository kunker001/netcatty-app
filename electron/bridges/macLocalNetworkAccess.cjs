"use strict";

/**
 * macOS Local Network privacy gate (Apple TN3179 / issues #1040, #2663, #2673).
 *
 * Since macOS 15, outbound TCP/UDP to LAN addresses requires the user's
 * Local Network privilege. Netcatty already declares
 * NSLocalNetworkUsageDescription and rewrites the main executable LC_UUID
 * (#1040), but SSH sessions normally run inside Electron's utilityProcess
 * (terminal worker). Connections from that helper often fail with
 * EHOSTUNREACH without ever registering "Netcatty" under
 * System Settings -> Privacy & Security -> Local Network - so the user never
 * gets a prompt and has nothing to toggle.
 *
 * Before the worker opens a LAN socket, the main process performs Apple's
 * recommended trigger: connect a UDP socket to a local-network address on
 * the discard port (9). That attributes the attempt to the app bundle and
 * can present the system alert without sending traffic (TN3179).
 *
 * Hostnames are resolved first so vault entries like "dev-viet" that map to
 * 192.168.x still probe; `.local` mDNS names are probed directly.
 */

const net = require("node:net");
const dgram = require("node:dgram");
const dns = require("node:dns");

/** Keep the pre-SSH LAN probe short so dead hosts do not stall the dial. */
const DEFAULT_PROBE_TIMEOUT_MS = 3_000;
/** Hold the connected UDP socket briefly so TCC can present the alert (FB16131937). */
const DEFAULT_PROBE_HOLD_MS = 500;
/** IANA discard service - Apple's TN3179 sample uses this port for the trigger. */
const DISCARD_PORT = 9;
const LOCAL_NETWORK_HINT =
  "macOS may be blocking Local Network access. Open System Settings -> Privacy & Security -> Local Network, enable Netcatty, then reconnect.";

const defaultLookup = dns.promises.lookup.bind(dns.promises);

function stripIpBrackets(value) {
  return String(value || "").replace(/^\[|\]$/g, "").trim();
}

function isIpv4LocalNetworkAddress(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d+$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((n) => n < 0 || n > 255)) return false;
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT / Tailscale
  return false;
}

/**
 * First hextet of an IPv6 address (handles leading "::" compression).
 * Returns null when the address is not a usable IPv6 form for prefix checks.
 */
function ipv6FirstHextet(address) {
  const lower = String(address || "").toLowerCase();
  if (!lower) return null;
  if (lower.startsWith("::ffff:")) return null;
  if (lower.startsWith("::")) return 0;
  const first = lower.split(":")[0];
  if (!/^[0-9a-f]{1,4}$/.test(first)) return null;
  return Number.parseInt(first, 16);
}

function isIpv6LocalNetworkAddress(hostname) {
  if (net.isIP(hostname) !== 6) return false;
  const lower = hostname.toLowerCase();
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 - classify the embedded v4 address.
    return isLocalNetworkHostname(lower.slice("::ffff:".length));
  }
  const hextet = ipv6FirstHextet(lower);
  if (hextet == null || Number.isNaN(hextet)) return false;
  // fc00::/7 unique local
  if (hextet >= 0xfc00 && hextet <= 0xfdff) return true;
  // fe80::/10 link-local
  if (hextet >= 0xfe80 && hextet <= 0xfebf) return true;
  return false;
}

/**
 * True only for literal private IP forms. Hostnames (including ones that
 * merely start with "fc"/"fd") are never treated as LAN without resolution.
 */
function isLocalNetworkHostname(hostname) {
  if (hostname == null) return false;
  const cleaned = stripIpBrackets(hostname);
  if (!cleaned) return false;

  const ipVersion = net.isIP(cleaned);
  if (ipVersion === 4) return isIpv4LocalNetworkAddress(cleaned);
  if (ipVersion === 6) return isIpv6LocalNetworkAddress(cleaned);
  return false;
}

/**
 * RFC 6762 mDNS names (*.local). Resolving or connecting to them requires
 * Local Network access on macOS 15+ (TN3179 DNS / Bonjour sections).
 */
function isLocalMdnsName(hostname) {
  if (hostname == null) return false;
  const cleaned = stripIpBrackets(hostname).toLowerCase().replace(/\.$/, "");
  if (!cleaned || cleaned === "localhost") return false;
  if (net.isIP(cleaned)) return false;
  return cleaned.endsWith(".local");
}

/**
 * Hostnames that commonly denote a LAN-side hop even when they are not
 * literal RFC1918 addresses or mDNS `.local` names (e.g. bastion.lan).
 */
function isPrivateDnsLanName(hostname) {
  if (hostname == null) return false;
  const cleaned = stripIpBrackets(hostname).toLowerCase().replace(/\.$/, "");
  if (!cleaned || cleaned === "localhost") return false;
  if (net.isIP(cleaned)) return false;
  return /\.(lan|internal|intranet|localdomain|home|corp|private)$/.test(cleaned);
}

/**
 * Single-label vault/jump names (e.g. "dev-viet") are usually LAN DNS.
 * Public first hops are typically FQDNs, so keep this narrow.
 */
function isUnqualifiedHostname(hostname) {
  if (hostname == null) return false;
  const cleaned = stripIpBrackets(hostname).toLowerCase().replace(/\.$/, "");
  if (!cleaned || cleaned === "localhost") return false;
  if (net.isIP(cleaned)) return false;
  return !cleaned.includes(".");
}

function looksLikeLocalNetworkName(hostname) {
  return isLocalNetworkHostname(hostname)
    || isLocalMdnsName(hostname)
    || isPrivateDnsLanName(hostname)
    || isUnqualifiedHostname(hostname);
}

/**
 * First TCP hop the local process will open for this SSH dial.
 * Prefer the first jump's HTTP/SOCKS proxy when set (sshBridge hop wiring),
 * else the session-level proxy, else the first jump host, else the target.
 * An active ProxyCommand is terminal: Electron never dials the TCP host
 * itself, so callers should skip the Local Network probe entirely.
 */
function resolveFirstTcpEndpoint(options = {}) {
  const commandProxySkip = (proxy) => {
    if (!proxy || typeof proxy !== "object") return null;
    if (proxy.type !== "command") return null;
    if (!String(proxy.command || "").trim()) return null;
    return { hostname: "", port: 0, skipProbe: true, reason: "command-proxy" };
  };

  const endpointFromProxy = (proxy, fallbackPort = 1080) => {
    if (!proxy || typeof proxy !== "object") return null;
    if (proxy.type === "command") return null;
    const hostname = String(proxy.host || proxy.hostname || "").trim();
    if (!hostname) return null;
    const port = Number(proxy.port);
    return {
      hostname,
      port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallbackPort,
    };
  };

  const jumpHosts = Array.isArray(options.jumpHosts) ? options.jumpHosts : [];
  const firstJump = jumpHosts.length > 0 ? (jumpHosts[0] || {}) : null;
  const jumpProxy = firstJump ? (firstJump.proxy || firstJump.proxyConfig || null) : null;
  const jumpCommandSkip = commandProxySkip(jumpProxy);
  if (jumpCommandSkip) return jumpCommandSkip;
  const jumpProxyEndpoint = endpointFromProxy(jumpProxy);
  if (jumpProxyEndpoint) return jumpProxyEndpoint;

  const sessionCommandSkip = commandProxySkip(options.proxy || null);
  if (sessionCommandSkip) return sessionCommandSkip;
  const sessionProxyEndpoint = endpointFromProxy(options.proxy || null);
  if (sessionProxyEndpoint) return sessionProxyEndpoint;

  if (firstJump) {
    const hostname = String(firstJump.hostname || firstJump.host || "").trim();
    const port = Number(firstJump.port);
    return {
      hostname,
      port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 22,
    };
  }

  const hostname = String(options.hostname || options.host || "").trim();
  const port = Number(options.port);
  return {
    hostname,
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 22,
  };
}

/**
 * Decide which hostname/IP to UDP-probe for Local Network TCC attribution.
 * @returns {Promise<{ hostname: string, reason: "literal"|"mdns"|"resolved" }|null>}
 */
async function resolveLanProbeTarget(hostname, options = {}) {
  const cleaned = stripIpBrackets(hostname);
  if (!cleaned) return null;
  if (isLocalNetworkHostname(cleaned)) {
    return { hostname: cleaned, reason: "literal" };
  }
  if (isLocalMdnsName(cleaned)) {
    return { hostname: cleaned, reason: "mdns" };
  }
  if (net.isIP(cleaned)) return null;

  const lookup = options.lookup || defaultLookup;
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(0, Math.round(options.timeoutMs))
    : DEFAULT_PROBE_TIMEOUT_MS;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;

  try {
    const results = await new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimer(timer);
        fn(value);
      };
      if (timeoutMs > 0) {
        timer = setTimer(() => finish(reject, Object.assign(new Error("LAN probe DNS timeout"), {
          code: "ETIMEDOUT",
        })), timeoutMs);
      }
      Promise.resolve()
        .then(() => lookup(cleaned, { all: true, verbatim: true }))
        .then((value) => finish(resolve, value))
        .catch((err) => finish(reject, err));
    });
    const list = Array.isArray(results) ? results : results ? [results] : [];
    for (const entry of list) {
      const address = typeof entry === "string" ? entry : entry?.address;
      if (address && isLocalNetworkHostname(address)) {
        return { hostname: stripIpBrackets(address), reason: "resolved" };
      }
    }
  } catch {
    // DNS failure / timeout is not fatal; skip the probe and let SSH dial.
  }
  return null;
}

function looksLikeHostUnreachableMessage(message) {
  const text = String(message || "");
  return /EHOSTUNREACH|ENETUNREACH|host is unreachable|network is unreachable/i.test(text);
}

/**
 * Pull unreachable *remote* addresses out of Node connect errors.
 * Strips the trailing `- Local (bind:port)` clause so the local bind IP
 * cannot be mistaken for a LAN destination (Codex #2673 follow-up).
 */
function extractRemoteUnreachableAddresses(text) {
  const withoutLocalBind = String(text || "").replace(/\s*-\s*Local\s*\([^)]*\)\s*$/i, "");
  const found = [];

  const pushIfLan = (value) => {
    const cleaned = stripIpBrackets(value);
    if (!cleaned) return;
    if (isLocalNetworkHostname(cleaned)) found.push(cleaned);
  };

  for (const ip of withoutLocalBind.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || []) {
    pushIfLan(ip);
  }
  for (const matched of withoutLocalBind.match(/\[([0-9a-fA-F:]+)\]/g) || []) {
    pushIfLan(matched.slice(1, -1));
  }

  const afterErr = withoutLocalBind.match(/(?:EHOSTUNREACH|ENETUNREACH)\s+(\S+)/i);
  if (afterErr) {
    const token = afterErr[1];
    const bracketed = token.match(/^\[([0-9a-fA-F:]+)\](?::\d+)?$/);
    if (bracketed) {
      pushIfLan(bracketed[1]);
    } else {
      pushIfLan(token);
      // Node often formats IPv6 as addr:port without brackets.
      const withoutPort = String(token).replace(/:(\d+)$/, "");
      if (withoutPort !== token) pushIfLan(withoutPort);
    }
  }

  return [...new Set(found)];
}

/**
 * Attach the LAN address resolved by ensureAccess onto start options so both
 * the worker path and the direct main-process fallback can annotate errors.
 */
function attachMacLocalNetworkProbeResult(options, probeResult) {
  const base = options && typeof options === "object" ? { ...options } : {};
  const resolvedFirstHop = probeResult && typeof probeResult.hostname === "string"
    ? String(probeResult.hostname).trim()
    : "";
  if (!resolvedFirstHop) return base;
  base._macLocalNetworkResolvedFirstHop = resolvedFirstHop;
  return base;
}

function annotateMacLocalNetworkErrorMessage(message, options = {}) {
  const platform = options.platform || process.platform;
  const text = String(message || "");
  if (platform !== "darwin") return text;
  if (!looksLikeHostUnreachableMessage(text)) return text;
  if (text.includes("Local Network")) return text;

  // ProxyCommand owns the dial outside Electron. Never append a Netcatty
  // Local Network hint - even when the child error embeds a LAN address -
  // because the user would be sent to enable Netcatty for a connection the
  // external command made.
  if (options.skipProbe === true) return text;

  const firstHop = String(options.firstHopHostname || "").trim();
  const firstHopResolved = String(options.firstHopResolvedAddress || "").trim();
  const targetHost = String(options.hostname || options.host || "").trim();
  const normalizeHost = (value) => stripIpBrackets(value).toLowerCase();
  // Only treat the vault target as LAN evidence when it is also the first TCP
  // hop. A .local final host reached via a public proxy/jump must not force
  // the Local Network hint when the failing dial never touched the LAN.
  const targetIsFirstHop = !firstHop
    || !targetHost
    || normalizeHost(targetHost) === normalizeHost(firstHop);

  // Embedded unreachable addresses often name a downstream hop that a public
  // proxy/jump dialed. Only treat them as LAN evidence when they identify the
  // local first-hop dial (hostname or the address ensureAccess resolved).
  const remotes = extractRemoteUnreachableAddresses(text);
  const remotesForEvidence = targetIsFirstHop
    ? remotes
    : remotes.filter((value) => {
      const normalized = normalizeHost(value);
      if (normalized === normalizeHost(firstHop)) return true;
      if (firstHopResolved && normalized === normalizeHost(firstHopResolved)) return true;
      // Unqualified / private-DNS first hops may lack a carried resolution.
      return looksLikeLocalNetworkName(firstHop) && isLocalNetworkHostname(value);
    });

  const candidates = [
    ...(targetIsFirstHop ? [options.hostname, options.host] : []),
    options.firstHopHostname,
    firstHopResolved || null,
    ...remotesForEvidence,
  ].filter((value) => value != null && String(value).trim() !== "");
  const touchesLan = candidates.some((value) => looksLikeLocalNetworkName(value));
  if (!touchesLan) return text;
  return `${text}\n\n${LOCAL_NETWORK_HINT}`;
}

function pickUdpTypes(hostname) {
  const cleaned = stripIpBrackets(hostname);
  if (net.isIP(cleaned) === 6) return ["udp6"];
  if (net.isIP(cleaned) === 4) return ["udp4"];
  // Unresolved hostnames (especially .local) may be IPv6-only on the LAN.
  // Node's udp4 sockets will not attempt AAAA, so try both families.
  return ["udp4", "udp6"];
}

function createMacLocalNetworkAccessGate(options = {}) {
  const platform = options.platform || process.platform;
  const versions = options.versions || process.versions;
  const dgramModule = options.dgram || dgram;
  const lookup = options.lookup || defaultLookup;
  const probedKeys = options.probedKeys || new Set();
  const inFlight = options.inFlight || new Map();
  const probeTimeoutMs = Number.isFinite(options.probeTimeoutMs)
    ? Math.max(500, Math.round(options.probeTimeoutMs))
    : DEFAULT_PROBE_TIMEOUT_MS;
  const probeHoldMs = Number.isFinite(options.probeHoldMs)
    ? Math.max(0, Math.round(options.probeHoldMs))
    : DEFAULT_PROBE_HOLD_MS;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const resolvedFirstHopByName = options.resolvedFirstHopByName || new Map();

  function rememberResolvedFirstHop(hostname, resolvedHostname) {
    const name = stripIpBrackets(hostname).toLowerCase();
    const resolved = stripIpBrackets(resolvedHostname);
    if (!name || !resolved) return;
    if (!isLocalNetworkHostname(resolved) && !isLocalMdnsName(resolved)) return;
    resolvedFirstHopByName.set(name, resolved);
  }

  function getResolvedFirstHop(hostname) {
    const name = stripIpBrackets(hostname).toLowerCase();
    if (!name) return "";
    return resolvedFirstHopByName.get(name) || "";
  }
  // Bare Node unit tests (and non-Electron CLIs) must never open LAN sockets.
  // Only the real Electron main process should trigger the TCC prompt.
  const electronRuntime = options.forceElectron === true
    || (options.forceElectron !== false && Boolean(versions?.electron));

  function probeKey(hostname) {
    return String(hostname).toLowerCase();
  }

  function runUdpProbeOnce(hostname, udpType, attemptTimeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      let socket = null;
      let safetyTimer = null;
      let holdTimer = null;
      const attemptMs = Math.max(1, Math.round(attemptTimeoutMs));

      const finish = (connected) => {
        if (settled) return;
        settled = true;
        if (safetyTimer) clearTimer(safetyTimer);
        if (holdTimer) clearTimer(holdTimer);
        safetyTimer = null;
        holdTimer = null;
        try { socket?.close(); } catch { /* ignore */ }
        resolve(connected === true);
      };

      try {
        socket = dgramModule.createSocket(udpType);
        socket.once?.("error", () => finish(false));
        safetyTimer = setTimer(() => finish(false), attemptMs);
        socket.connect(DISCARD_PORT, hostname, () => {
          if (settled) return;
          // Clear the connect safety window once connected so a slow
          // .local/mDNS resolve cannot truncate the intentional hold
          // that gives TCC time to present the Local Network alert.
          if (safetyTimer) {
            clearTimer(safetyTimer);
            safetyTimer = null;
          }
          if (probeHoldMs <= 0) {
            finish(true);
            return;
          }
          holdTimer = setTimer(() => finish(true), probeHoldMs);
        });
      } catch {
        finish(false);
      }
    });
  }

  async function runUdpProbe(hostname, budgetMs = probeTimeoutMs) {
    const types = pickUdpTypes(hostname);
    const totalMs = Number.isFinite(budgetMs) ? Math.max(0, Math.round(budgetMs)) : probeTimeoutMs;
    if (totalMs <= 0) return;
    const deadlineAt = Date.now() + totalMs;
    for (let index = 0; index < types.length; index += 1) {
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) return;
      const familiesLeft = types.length - index;
      // Split the residual budget so a stalled udp4 resolve cannot consume
      // the entire window before the udp6 fallback for IPv6-only .local hosts.
      const sliceMs = familiesLeft > 1
        ? Math.max(1, Math.floor(remainingMs / familiesLeft))
        : remainingMs;
      const connected = await runUdpProbeOnce(hostname, types[index], sliceMs);
      if (connected) return;
    }
  }

  async function ensureAccess(connectOptions = {}) {
    if (platform !== "darwin") return { skipped: true, reason: "platform" };
    if (!electronRuntime) return { skipped: true, reason: "not-electron" };
    // Main process already probed before forwarding into the terminal
    // worker; skip the second hold in utilityProcess (#2673 Codex P2).
    if (connectOptions._macLocalNetworkMainProbed === true) {
      return { skipped: true, reason: "main-probed" };
    }

    const endpoint = resolveFirstTcpEndpoint(connectOptions);
    if (endpoint.skipProbe === true) {
      return { skipped: true, reason: endpoint.reason || "command-proxy" };
    }
    if (!endpoint.hostname) {
      return { skipped: true, reason: "not-local-network" };
    }

    // One wall-clock budget covers DNS resolution + UDP family attempts.
    const deadlineAt = Date.now() + probeTimeoutMs;
    const target = await resolveLanProbeTarget(endpoint.hostname, {
      lookup,
      timeoutMs: Math.max(0, deadlineAt - Date.now()),
      setTimer,
      clearTimer,
    });
    if (!target) {
      return { skipped: true, reason: "not-local-network" };
    }
    rememberResolvedFirstHop(endpoint.hostname, target.hostname);

    const key = probeKey(target.hostname);
    if (probedKeys.has(key)) {
      return { skipped: true, reason: "cached", hostname: target.hostname };
    }

    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      return { skipped: true, reason: "timeout", hostname: target.hostname };
    }

    const pending = inFlight.get(key);
    if (pending) {
      await pending;
      return { skipped: true, reason: "in-flight", hostname: target.hostname };
    }

    const probe = runUdpProbe(target.hostname, remainingMs).finally(() => {
      inFlight.delete(key);
      probedKeys.add(key);
    });
    inFlight.set(key, probe);
    await probe;
    return {
      probed: true,
      hostname: target.hostname,
      port: DISCARD_PORT,
      reason: target.reason,
    };
  }

  return {
    ensureAccess,
    isLocalNetworkHostname,
    isLocalMdnsName,
    resolveFirstTcpEndpoint,
    getProbeTimeoutMs: () => probeTimeoutMs,
    getProbeHoldMs: () => probeHoldMs,
    getResolvedFirstHop,
    annotateErrorMessage(message, connectOptions = {}) {
      const endpoint = resolveFirstTcpEndpoint(connectOptions);
      const firstHopHostname = endpoint.skipProbe ? "" : endpoint.hostname;
      const firstHopResolvedAddress = endpoint.skipProbe
        ? ""
        : (
          connectOptions._macLocalNetworkResolvedFirstHop
          || connectOptions.firstHopResolvedAddress
          || getResolvedFirstHop(firstHopHostname)
        );
      return annotateMacLocalNetworkErrorMessage(message, {
        platform,
        hostname: connectOptions.hostname || connectOptions.host,
        firstHopHostname,
        firstHopResolvedAddress,
        skipProbe: endpoint.skipProbe === true,
      });
    },
  };
}

const defaultGate = createMacLocalNetworkAccessGate();

module.exports = {
  LOCAL_NETWORK_HINT,
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
  ensureMacLocalNetworkAccess: (options) => defaultGate.ensureAccess(options),
  annotateMacLocalNetworkError: (message, options) => defaultGate.annotateErrorMessage(message, options),
};
