const test = require("node:test");
const assert = require("node:assert/strict");

const { registerHandlers } = require("./githubAuthBridge.cjs");

function createIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, fn) {
      handlers.set(channel, fn);
    },
  };
}

test("GitHub device flow uses electron.net.fetch when available", async () => {
  const calls = [];
  const ipcMain = createIpcMain();
  registerHandlers(ipcMain, {
    net: {
      fetch: async (url, init) => {
        calls.push({ url, method: init?.method });
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              device_code: "dc",
              user_code: "uc",
              verification_uri: "https://github.com/login/device",
              expires_in: 900,
              interval: 5,
            });
          },
        };
      },
    },
  });

  const start = ipcMain.handlers.get("netcatty:github:deviceFlow:start");
  const result = await start(null, { clientId: "client" });
  assert.equal(result.deviceCode, "dc");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /github\.com\/login\/device\/code/);
});

test("GitHub Gist raw content uses the main process without renderer CORS", async () => {
  const calls = [];
  const ipcMain = createIpcMain();
  registerHandlers(ipcMain, {
    net: {
      fetch: async (url, init) => {
        calls.push({ url, headers: init?.headers });
        return {
          ok: true,
          status: 200,
          async text() {
            return '{"payload":"full"}';
          },
        };
      },
    },
  });

  const download = ipcMain.handlers.get("netcatty:github:gistRawContent");
  const result = await download(null, {
    accessToken: "token",
    rawUrl: "https://gist.githubusercontent.com/u/gist/raw/file.json",
  });
  assert.equal(result, '{"payload":"full"}');
  assert.deepEqual(calls, [{
    url: "https://gist.githubusercontent.com/u/gist/raw/file.json",
    headers: {
      Authorization: "Bearer token",
      Accept: "application/vnd.github.raw",
    },
  }]);
});

test("GitHub Gist raw content rejects URLs outside the raw host", async () => {
  const ipcMain = createIpcMain();
  registerHandlers(ipcMain, {
    net: { fetch: async () => { throw new Error("must not fetch"); } },
  });

  const download = ipcMain.handlers.get("netcatty:github:gistRawContent");
  await assert.rejects(
    download(null, {
      accessToken: "token",
      rawUrl: "https://example.com/steal",
    }),
    /gist\.githubusercontent\.com/,
  );
});
