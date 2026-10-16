/**
 * HTTP network proxy bridge — applies app-level proxy for Chromium sessions
 * (electron.net.fetch used by Google/OneDrive/GitHub OAuth) and Node HTTP stacks
 * (AI providerHandlers, WebDAV, S3, electron-updater).
 *
 * Not related to SSH ProxyJump / ProxyCommand vault profiles.
 */

"use strict";

const DEFAULT_SETTINGS = Object.freeze({
  mode: "system",
  url: "",
  bypass: "<local>",
});

const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
];

const VALID_MODES = new Set(["system", "direct", "custom"]);

function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Strip userinfo from proxy URLs without rewriting the rest of the string.
 * Electron proxyRules does not support credentials. Avoid `new URL()` so
 * incomplete drafts like `http://127.0.0.1:` keep the trailing colon.
 */
function sanitizeProxyUrl(proxyUrl) {
  const trimmed = asTrimmedString(proxyUrl);
  if (!trimmed) return "";
  // Strip userinfo for both scheme URLs and scheme-less drafts.
  return trimmed.replace(/^([a-z][a-z0-9+.-]*:\/\/)?([^/?#]*@)/i, "$1");
}

function normalizeProxySettingsPayload(raw) {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_SETTINGS };
  }

  const modeRaw = asTrimmedString(raw.mode);
  const mode = VALID_MODES.has(modeRaw) ? modeRaw : "system";
  const url = sanitizeProxyUrl(raw.url);
  const bypass = asTrimmedString(raw.bypass) || DEFAULT_SETTINGS.bypass;

  if (mode === "system") {
    return { mode: "system", url: "", bypass: DEFAULT_SETTINGS.bypass };
  }
  if (mode === "direct") {
    return { mode: "direct", url: "", bypass: DEFAULT_SETTINGS.bypass };
  }
  // Keep custom+empty as a draft so the settings UI can show URL fields.
  return { mode: "custom", url, bypass };
}

/** Effective mode for Electron/env apply: empty custom acts like system. */
function effectiveApplySettings(settings) {
  if (settings.mode === "custom" && !settings.url) {
    return { mode: "system", url: "", bypass: DEFAULT_SETTINGS.bypass };
  }
  return settings;
}

function buildElectronProxyConfigFromPayload(raw) {
  const settings = effectiveApplySettings(normalizeProxySettingsPayload(raw));
  if (settings.mode === "direct") return { mode: "direct" };
  if (settings.mode === "custom") {
    return {
      mode: "fixed_servers",
      proxyRules: settings.url,
      proxyBypassRules: settings.bypass || DEFAULT_SETTINGS.bypass,
    };
  }
  return { mode: "system" };
}

/**
 * Strip userinfo from a proxy URL before writing to process.env so local
 * terminals / spawned tools do not inherit proxy credentials.
 * (normalizeProxySettingsPayload already strips credentials; this is defense in depth.)
 */
function sanitizeProxyUrlForEnv(proxyUrl) {
  return sanitizeProxyUrl(proxyUrl);
}

/** Snapshot of env values before this feature last wrote them (WeakMap by env object). */
const ownedEnvSnapshots = new WeakMap();
let applyGeneration = 0;
let applyChain = Promise.resolve();

function captureEnvSnapshot(env) {
  const snapshot = {};
  for (const key of PROXY_ENV_KEYS) {
    snapshot[key] = Object.prototype.hasOwnProperty.call(env, key) ? env[key] : undefined;
  }
  return snapshot;
}

function restoreEnvSnapshot(env, snapshot) {
  if (!snapshot) return;
  for (const key of PROXY_ENV_KEYS) {
    if (snapshot[key] === undefined) {
      delete env[key];
    } else {
      env[key] = snapshot[key];
    }
  }
}

/**
 * Apply or clear Node proxy env vars on `env` (defaults to process.env).
 *
 * - custom (with URL): snapshot prior values once, then write redacted proxy URL/bypass
 * - direct: snapshot prior values once (if needed), then clear proxy env
 * - system / empty custom: restore the snapshot captured before this feature mutated env
 *
 * Credentials in the proxy URL are stripped before writing to env so child
 * processes (local terminals) do not inherit user:pass.
 */
function applyNodeProxyEnv(raw, env = process.env) {
  const settings = effectiveApplySettings(normalizeProxySettingsPayload(raw));

  if (settings.mode === "system") {
    const snapshot = ownedEnvSnapshots.get(env);
    if (snapshot) {
      restoreEnvSnapshot(env, snapshot);
      ownedEnvSnapshots.delete(env);
    }
    return { applied: false, settings };
  }

  if (!ownedEnvSnapshots.has(env)) {
    ownedEnvSnapshots.set(env, captureEnvSnapshot(env));
  }

  if (settings.mode === "direct") {
    for (const key of PROXY_ENV_KEYS) {
      delete env[key];
    }
    return { applied: true, settings };
  }

  const safeUrl = sanitizeProxyUrlForEnv(settings.url);
  env.HTTP_PROXY = safeUrl;
  env.HTTPS_PROXY = safeUrl;
  env.NO_PROXY = settings.bypass || "";
  env.http_proxy = safeUrl;
  env.https_proxy = safeUrl;
  env.no_proxy = settings.bypass || "";
  return { applied: true, settings };
}

function resetProxyEnvOwnershipForTests() {
  // WeakMap cannot be cleared; tests use fresh env objects.
  applyGeneration = 0;
  applyChain = Promise.resolve();
}

/**
 * Clone `baseEnv` for local terminal / PTY children, restoring the proxy env
 * values that existed before this feature mutated process.env.
 *
 * App-level Direct/Custom modes intentionally rewrite process.env for Node
 * HTTP clients (AI, updater). Terminals should keep the user's launch-time
 * HTTP(S)_PROXY / NO_PROXY instead of inheriting those app-only overrides.
 */
function buildTerminalProcessEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  const snapshot = ownedEnvSnapshots.get(baseEnv) || ownedEnvSnapshots.get(process.env);
  if (snapshot) {
    restoreEnvSnapshot(env, snapshot);
  }
  return env;
}

let currentSettings = { ...DEFAULT_SETTINGS };

function getCurrentProxySettings() {
  return { ...currentSettings };
}

async function applyHttpNetworkProxy(raw, deps = {}) {
  const settings = normalizeProxySettingsPayload(raw);
  const electronConfig = buildElectronProxyConfigFromPayload(settings);
  const generation = ++applyGeneration;
  const env = deps.env || process.env;

  // Serialize setProxy so an older slow call cannot overwrite a newer one.
  const previous = applyChain;
  let release;
  applyChain = new Promise((resolve) => {
    release = resolve;
  });

  try {
    await previous.catch(() => {});
    if (generation !== applyGeneration) {
      return { success: false, settings, electronConfig, superseded: true };
    }

    const session =
      deps.session ||
      deps.electronModule?.session?.defaultSession ||
      null;

    if (session?.setProxy) {
      await session.setProxy(electronConfig);
    }

    if (generation !== applyGeneration) {
      return { success: false, settings, electronConfig, superseded: true };
    }

    currentSettings = settings;
    applyNodeProxyEnv(settings, env);
    return { success: true, settings, electronConfig };
  } finally {
    release();
  }
}

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {import('electron')=} electronModule
 */
function registerHandlers(ipcMain, electronModule) {
  ipcMain.handle("netcatty:networkProxy:set", async (_event, payload) => {
    return applyHttpNetworkProxy(payload, { electronModule });
  });

  ipcMain.handle("netcatty:networkProxy:get", async () => {
    return { settings: getCurrentProxySettings() };
  });
}

module.exports = {
  DEFAULT_SETTINGS,
  normalizeProxySettingsPayload,
  buildElectronProxyConfigFromPayload,
  applyNodeProxyEnv,
  applyHttpNetworkProxy,
  buildTerminalProcessEnv,
  getCurrentProxySettings,
  resetProxyEnvOwnershipForTests,
  sanitizeProxyUrlForEnv,
  registerHandlers,
};
