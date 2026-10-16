/**
 * Build a Node http(s) Agent for outbound requests based on current
 * app-level proxy settings. Used by AI providerHandlers / streamRequest.
 *
 * Prefer Electron session.resolveProxy so "system" mode works on Windows
 * (where Node does not read the OS proxy by itself).
 */

"use strict";

const { URL } = require("node:url");

let HttpsProxyAgent;
let HttpProxyAgent;
let SocksProxyAgent;

function loadAgents() {
  if (!HttpsProxyAgent) {
    ({ HttpsProxyAgent } = require("https-proxy-agent"));
  }
  if (!HttpProxyAgent) {
    ({ HttpProxyAgent } = require("http-proxy-agent"));
  }
  if (!SocksProxyAgent) {
    try {
      ({ SocksProxyAgent } = require("socks-proxy-agent"));
    } catch {
      SocksProxyAgent = null;
    }
  }
}

function createAgentFromProxyUrl(proxyUrl, targetIsHttps, options = {}) {
  loadAgents();
  const trimmed = String(proxyUrl || "").trim();
  if (!trimmed) return undefined;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }

  // Do not pass rejectUnauthorized into the proxy-agent constructor: that option
  // weakens TLS to the *proxy hop*. allowInsecure / skipTLS only applies to the
  // tunneled target via applyInsecureTargetTls below.
  const protocol = parsed.protocol.toLowerCase();
  let agent;
  if (protocol === "socks:" || protocol === "socks5:" || protocol === "socks4:") {
    if (!SocksProxyAgent) return undefined;
    agent = new SocksProxyAgent(trimmed);
  } else if (targetIsHttps) {
    agent = new HttpsProxyAgent(trimmed);
  } else {
    agent = new HttpProxyAgent(trimmed);
  }

  // https-proxy-agent / socks-proxy-agent apply constructor rejectUnauthorized to
  // the proxy hop, not the tunneled target TLS upgrade. When callers need
  // allowInsecure for self-signed *targets*, force it on the connect opts.
  if (options.rejectUnauthorized === false && targetIsHttps) {
    applyInsecureTargetTls(agent);
  }

  return agent;
}

/**
 * Force rejectUnauthorized:false onto the tunneled target TLS upgrade.
 * Constructor options alone only affect the proxy hop.
 */
function applyInsecureTargetTls(agent) {
  if (!agent || typeof agent.connect !== "function") return agent;
  const originalConnect = agent.connect.bind(agent);
  agent.connect = (req, opts) =>
    originalConnect(req, { ...opts, rejectUnauthorized: false });
  return agent;
}

/**
 * Parse Chromium resolveProxy result, e.g. "PROXY 127.0.0.1:7890" / "SOCKS5 host:1080" / "DIRECT".
 */
function proxyInfoFromResolveResult(result) {
  const text = String(result || "").trim();
  if (!text || /^DIRECT\b/i.test(text)) return null;

  // Take the first directive only.
  const first = text.split(";")[0].trim();
  const match = first.match(/^(PROXY|HTTPS|HTTP|SOCKS5|SOCKS4|SOCKS)\s+(.+)$/i);
  if (!match) return null;

  const kind = match[1].toUpperCase();
  const endpoint = match[2].trim();
  if (kind.startsWith("SOCKS")) {
    const scheme = kind === "SOCKS4" ? "socks4" : "socks5";
    return `${scheme}://${endpoint}`;
  }
  if (kind === "HTTPS") {
    return `https://${endpoint}`;
  }
  return `http://${endpoint}`;
}

/**
 * @param {string} targetUrl
 * @param {{ session?: Electron.Session, settings?: { mode: string, url: string } }} [deps]
 * @returns {Promise<import('node:http').Agent | undefined>}
 */
async function resolveOutboundHttpAgent(targetUrl, deps = {}) {
  const {
    getCurrentProxySettings,
  } = require("./httpNetworkProxyBridge.cjs");

  const settings = deps.settings || getCurrentProxySettings();
  if (!settings || settings.mode === "direct") return undefined;

  let targetIsHttps = true;
  try {
    targetIsHttps = new URL(targetUrl).protocol === "https:";
  } catch {
    // keep https default
  }

  const agentOptions = {};
  if (deps.rejectUnauthorized === false) {
    agentOptions.rejectUnauthorized = false;
  }

  const session = deps.session || null;
  if (session?.resolveProxy) {
    try {
      const resolved = await session.resolveProxy(targetUrl);
      const proxyUrl = proxyInfoFromResolveResult(resolved);
      if (!proxyUrl) return undefined;
      return createAgentFromProxyUrl(proxyUrl, targetIsHttps, agentOptions);
    } catch {
      // fall through to custom URL
    }
  }

  if (settings.mode === "custom" && settings.url) {
    return createAgentFromProxyUrl(settings.url, targetIsHttps, agentOptions);
  }

  return undefined;
}

module.exports = {
  createAgentFromProxyUrl,
  applyInsecureTargetTls,
  proxyInfoFromResolveResult,
  resolveOutboundHttpAgent,
};
