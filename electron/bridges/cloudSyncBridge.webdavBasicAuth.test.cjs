const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const {
  buildBasicAuthHeader,
  handleWebdavInitialize,
} = require("./cloudSyncBridge.cjs");

// Per RFC 7617, Basic Auth credentials are UTF-8 encoded before base64.
// The upstream `webdav` npm package (via `base-64`) encodes them as Latin1
// instead, which silently corrupts non-ASCII characters like German umlauts
// (ö, ä) — exactly the case reported by Hetzner Storage Box users (#891).
//
// `ö` (U+00F6):
//   Latin1 → 1 byte:  F6
//   UTF-8  → 2 bytes: C3 B6
const PASSWORD_WITH_UMLAUT = "6?G:ö9yZöäMF+H3";
const USERNAME = "uHetzner1";

test("buildBasicAuthHeader UTF-8 encodes credentials (RFC 7617)", () => {
  const header = buildBasicAuthHeader("user", "ö");
  // UTF-8 base64 of "user:ö" = "user" + ":" + 0xC3 0xB6
  assert.equal(header, "Basic dXNlcjrDtg==");
});

test("buildBasicAuthHeader stays compatible with pure-ASCII credentials", () => {
  // For ASCII, UTF-8 and Latin1 are byte-identical, so the header is unchanged.
  const header = buildBasicAuthHeader("user", "password");
  assert.equal(header, "Basic dXNlcjpwYXNzd29yZA==");
});

function startUtf8BasicAuthServer({ username, password }) {
  const expected =
    "Basic " +
    Buffer.from(`${username}:${password}`, "utf8").toString("base64");

  const server = http.createServer((req, res) => {
    const got = req.headers["authorization"];
    if (got !== expected) {
      res.writeHead(401, {
        "WWW-Authenticate": 'Basic realm="test", charset="UTF-8"',
      });
      res.end("Unauthorized");
      return;
    }
    // Minimal but parseable PROPFIND response so client.exists() resolves true.
    res.writeHead(207, { "Content-Type": "application/xml; charset=utf-8" });
    res.end(
      `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>${req.url}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>netcatty-vault.json</D:displayname>
        <D:getlastmodified>Sat, 10 May 2026 00:00:00 GMT</D:getlastmodified>
        <D:getcontentlength>0</D:getcontentlength>
        <D:resourcetype/>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`,
    );
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, endpoint: `http://127.0.0.1:${port}` });
    });
  });
}

test("handleWebdavInitialize sends UTF-8 Basic Auth (Hetzner umlaut password #891)", async () => {
  const { server, endpoint } = await startUtf8BasicAuthServer({
    username: USERNAME,
    password: PASSWORD_WITH_UMLAUT,
  });
  try {
    const result = await handleWebdavInitialize({
      endpoint,
      authType: "password",
      username: USERNAME,
      password: PASSWORD_WITH_UMLAUT,
    });
    assert.equal(result.resourceId, "/netcatty-vault.json");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
