"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  browserRasterizeExpression,
  createIsolatedContributionIconRasterizer,
} = require("./contributionIconRasterizer.cjs");

test("viewBox-only SVG icons receive an explicit isolated raster viewport", () => {
  const expression = browserRasterizeExpression({
    source: Buffer.from('<svg viewBox="0 0 32 16"><path d="M0 0h1"/></svg>').toString("base64"),
    mimeType: "image/svg+xml",
    width: 32,
    height: 16,
    maxEdge: 64,
  });
  assert.match(expression, /DOMParser/u);
  assert.match(expression, /setAttribute\("width"/u);
  assert.match(expression, /setAttribute\("height"/u);
});

test("contribution icons rasterize in a disposable sandboxed network-denied window", async () => {
  let createdOptions;
  let destroyed = false;
  let requestFilter;
  let expression = "";
  class BrowserWindowStub {
    constructor(options) {
      createdOptions = options;
      this.webContents = {
        session: {
          webRequest: {
            onBeforeRequest(filter, listener) { requestFilter = { filter, listener }; },
          },
        },
        async executeJavaScript(nextExpression) {
          expression = nextExpression;
          return `data:image/png;base64,${Buffer.from("bounded-png").toString("base64")}`;
        },
      };
    }
    async loadURL(url) { assert.match(url, /^data:text\/html/); }
    removeMenu() {}
    destroy() { destroyed = true; }
  }
  const rasterize = createIsolatedContributionIconRasterizer({
    BrowserWindow: BrowserWindowStub,
    randomUUID: () => "fixed",
  });

  assert.deepEqual(await rasterize({
    body: Buffer.from("untrusted"),
    mimeType: "image/png",
    width: 32,
    height: 16,
    maxEdge: 64,
  }), Buffer.from("bounded-png"));
  assert.equal(createdOptions.show, false);
  assert.equal(createdOptions.webPreferences.partition, "plugin-icon-raster-fixed");
  assert.equal(createdOptions.webPreferences.sandbox, true);
  assert.equal(createdOptions.webPreferences.nodeIntegration, false);
  assert.equal(createdOptions.webPreferences.contextIsolation, true);
  assert.equal(createdOptions.webPreferences.spellcheck, false);
  assert.deepEqual(requestFilter.filter.urls, ["http://*/*", "https://*/*", "file://*/*", "ftp://*/*"]);
  let blocked;
  requestFilter.listener({}, (decision) => { blocked = decision; });
  assert.deepEqual(blocked, { cancel: true });
  assert.match(expression, /dW50cnVzdGVk/);
  assert.equal(destroyed, true);
});

test("timed-out contribution icon rasterizers always destroy their isolated window", async () => {
  let destroyed = false;
  class BrowserWindowStub {
    constructor() {
      this.webContents = {
        session: { webRequest: { onBeforeRequest() {} } },
        executeJavaScript: () => new Promise(() => {}),
      };
    }
    async loadURL() {}
    destroy() { destroyed = true; }
  }
  const rasterize = createIsolatedContributionIconRasterizer({
    BrowserWindow: BrowserWindowStub,
    timeoutMs: 5,
  });
  await assert.rejects(rasterize({
    body: Buffer.from("untrusted"),
    mimeType: "image/png",
    width: 1,
    height: 1,
    maxEdge: 64,
  }), /timed out/);
  assert.equal(destroyed, true);
});
