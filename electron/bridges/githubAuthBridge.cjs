/**
 * GitHub OAuth Bridge (main process)
 *
 * Renderer fetches to `github.com/login/*` are blocked by CORS.
 * This bridge proxies GitHub Device Flow endpoints via the main process.
 */

const GITHUB_CLIENT_ID = process.env.VITE_SYNC_GITHUB_CLIENT_ID || "";
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_GIST_RAW_ORIGIN = "https://gist.githubusercontent.com";
const pendingPollControllers = new Map();

function normalizeGistRawUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid GitHub Gist raw URL");
  }
  if (url.origin !== GITHUB_GIST_RAW_ORIGIN || url.protocol !== "https:") {
    throw new Error("GitHub Gist raw URL must use gist.githubusercontent.com");
  }
  return url.href;
}

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {import('electron')=} electronModule
 */
function registerHandlers(ipcMain, electronModule) {
  const fetchImpl =
    electronModule?.net?.fetch ? electronModule.net.fetch.bind(electronModule.net) : fetch;

  ipcMain.handle("netcatty:github:deviceFlow:start", async (_event, payload) => {
    const clientId = payload?.clientId || GITHUB_CLIENT_ID;
    const scope = payload?.scope || "gist read:user";

    const res = await fetchImpl(GITHUB_DEVICE_CODE_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        scope,
      }).toString(),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`GitHub device flow failed: ${res.status} - ${text}`);
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`GitHub device flow invalid JSON: ${text.slice(0, 200)}`);
    }

    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresAt: Date.now() + (data.expires_in || 0) * 1000,
      interval: data.interval || 5,
    };
  });

  ipcMain.handle("netcatty:github:deviceFlow:poll", async (_event, payload) => {
    const clientId = payload?.clientId || GITHUB_CLIENT_ID;
    const deviceCode = payload?.deviceCode;
    const pollId = payload?.pollId;
    if (!deviceCode) throw new Error("Missing deviceCode");

    const controller = new AbortController();
    if (pollId) {
      pendingPollControllers.set(pollId, controller);
    }

    try {
      const res = await fetchImpl(GITHUB_ACCESS_TOKEN_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: clientId,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }).toString(),
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(`GitHub token polling failed: ${res.status} - ${text}`);
      }

      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`GitHub token polling invalid JSON: ${text.slice(0, 200)}`);
      }
    } finally {
      if (pollId) {
        pendingPollControllers.delete(pollId);
      }
    }
  });

  ipcMain.handle("netcatty:github:deviceFlow:cancelPoll", async (_event, pollId) => {
    if (!pollId) return;
    const controller = pendingPollControllers.get(pollId);
    if (!controller) return;
    pendingPollControllers.delete(pollId);
    controller.abort();
  });

  ipcMain.handle("netcatty:github:gistRawContent", async (_event, payload) => {
    const accessToken = payload?.accessToken;
    if (typeof accessToken !== "string" || !accessToken) {
      throw new Error("Missing GitHub access token");
    }
    const rawUrl = normalizeGistRawUrl(payload?.rawUrl);
    const res = await fetchImpl(rawUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.raw",
      },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Failed to download full gist content: ${res.status} - ${text.slice(0, 200)}`);
    }
    return text;
  });
}

module.exports = { registerHandlers };
