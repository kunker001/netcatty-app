"use strict";

const { randomUUID } = require("node:crypto");

const DEFAULT_RASTER_TIMEOUT_MS = 5_000;

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function browserRasterizeExpression(payload) {
  return `(async (payload) => {
    const image = new Image();
    image.decoding = "sync";
    if (payload.mimeType === "image/svg+xml") {
      const bytes = Uint8Array.from(atob(payload.source), (character) => character.charCodeAt(0));
      const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const document = new DOMParser().parseFromString(source, "image/svg+xml");
      const root = document.documentElement;
      if (root.localName !== "svg" || document.querySelector("parsererror")) {
        throw new Error("Plugin contribution SVG icon is invalid");
      }
      root.setAttribute("width", String(payload.width));
      root.setAttribute("height", String(payload.height));
      const normalized = new XMLSerializer().serializeToString(root);
      image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(normalized);
    } else {
      image.src = "data:" + payload.mimeType + ";base64," + payload.source;
    }
    await image.decode();
    if (image.naturalWidth !== payload.width || image.naturalHeight !== payload.height) {
      throw new Error("Plugin contribution icon dimensions changed during decoding");
    }
    const scale = Math.min(1, payload.maxEdge / image.naturalWidth, payload.maxEdge / image.naturalHeight);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true, desynchronized: false });
    if (!context) throw new Error("Plugin contribution icon canvas is unavailable");
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  })(${JSON.stringify(payload)})`;
}

function createIsolatedContributionIconRasterizer(options) {
  const BrowserWindow = options?.BrowserWindow;
  const randomUUIDFn = options?.randomUUID ?? randomUUID;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_RASTER_TIMEOUT_MS;
  return async ({ body, mimeType, width, height, maxEdge }) => {
    if (typeof BrowserWindow !== "function") {
      throw new Error("Isolated plugin contribution icon rasterizer is unavailable");
    }
    const partition = `plugin-icon-raster-${randomUUIDFn()}`;
    const win = new BrowserWindow({
      show: false,
      width: maxEdge,
      height: maxEdge,
      webPreferences: {
        partition,
        sandbox: true,
          spellcheck: false,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        backgroundThrottling: false,
      },
    });
    try {
      win.removeMenu?.();
      win.webContents?.session?.webRequest?.onBeforeRequest?.(
        { urls: ["http://*/*", "https://*/*", "file://*/*", "ftp://*/*"] },
        (_details, callback) => callback({ cancel: true }),
      );
      await withTimeout(
        Promise.resolve(win.loadURL("data:text/html;charset=utf-8,%3Cmeta%20http-equiv%3D%22Content-Security-Policy%22%20content%3D%22default-src%20'none'%3B%20img-src%20data%3A%3B%22%3E")),
        timeoutMs,
        "Plugin contribution icon rasterizer did not load in time",
      );
      const result = await withTimeout(
        Promise.resolve(win.webContents.executeJavaScript(browserRasterizeExpression({
          source: body.toString("base64"),
          mimeType,
          width,
          height,
          maxEdge,
        }), true)),
        timeoutMs,
        "Plugin contribution icon rasterization timed out",
      );
      const prefix = "data:image/png;base64,";
      if (typeof result !== "string" || !result.startsWith(prefix)) {
        throw new Error("Plugin contribution icon rasterizer returned an invalid result");
      }
      return Buffer.from(result.slice(prefix.length), "base64");
    } finally {
      try { win.destroy(); } catch {}
    }
  };
}

module.exports = {
  DEFAULT_RASTER_TIMEOUT_MS,
  browserRasterizeExpression,
  createIsolatedContributionIconRasterizer,
};
