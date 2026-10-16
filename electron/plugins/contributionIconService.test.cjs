"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  PluginContributionIconService,
  createBoundedIconRasterizer,
  inspectContributionIconSource,
} = require("./contributionIconService.cjs");

function pngHeader(width, height) {
  const body = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(body);
  body.writeUInt32BE(13, 8);
  body.write("IHDR", 12, "ascii");
  body.writeUInt32BE(width, 16);
  body.writeUInt32BE(height, 20);
  return body;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-plugin-icon-"));
  fs.mkdirSync(path.join(root, "assets"));
  fs.writeFileSync(path.join(root, "assets", "light.png"), pngHeader(128, 64));
  fs.writeFileSync(path.join(root, "assets", "dark.png"), pngHeader(128, 64));
  const icon = { kind: "package", light: "assets/light.png", dark: "assets/dark.png" };
  const plugin = {
    id: "com.example.icon",
    activeVersion: "1.0.0",
    enabled: true,
    runtime: { quarantinedAt: null },
    manifest: { contributes: { views: [{ id: "com.example.icon.view", icon }] } },
  };
  const rasterized = [];
  const service = new PluginContributionIconService({
    database: { getActivePlugin: (id) => id === plugin.id ? plugin : null },
    packageStore: { preparePackageRoot: async () => root },
    async rasterizeIcon(input) {
      rasterized.push({ mimeType: input.mimeType, width: input.width, height: input.height, maxEdge: input.maxEdge });
      return pngHeader(64, 32);
    },
  });
  return { icon, plugin, rasterized, root, service };
}

test("package contribution icons are declaration-bound, integrity-prepared, and rasterized", async (t) => {
  const { icon, plugin, rasterized, root, service } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.deepEqual(await service.resolve({ pluginId: plugin.id, icon }), {
    light: `data:image/png;base64,${pngHeader(64, 32).toString("base64")}`,
    dark: `data:image/png;base64,${pngHeader(64, 32).toString("base64")}`,
  });
  assert.deepEqual(rasterized, [
    { mimeType: "image/png", width: 128, height: 64, maxEdge: 64 },
    { mimeType: "image/png", width: 128, height: 64, maxEdge: 64 },
  ]);
});

test("concurrent requests for one declared package icon share one isolated decode", async (t) => {
  const { icon, plugin, rasterized, root, service } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const [first, second] = await Promise.all([
    service.resolve({ pluginId: plugin.id, icon }),
    service.resolve({ pluginId: plugin.id, icon }),
  ]);
  assert.equal(first, second);
  assert.equal(rasterized.length, 2);
});

test("isolated icon decoding has bounded concurrency and queue depth", async () => {
  let releaseFirst;
  const started = [];
  const rasterize = createBoundedIconRasterizer(async ({ id }) => {
    started.push(id);
    if (id === "first") await new Promise((resolve) => { releaseFirst = resolve; });
    return id;
  }, { maxConcurrent: 1, maxQueued: 1 });

  const first = rasterize({ id: "first" });
  const second = rasterize({ id: "second" });
  await assert.rejects(rasterize({ id: "third" }), /queue is full/);
  assert.deepEqual(started, ["first"]);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
  assert.deepEqual(started, ["first", "second"]);
});

test("package contribution icon lookup rejects paths not declared by the active manifest", async (t) => {
  const { plugin, root, service } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  await assert.rejects(service.resolve({
    pluginId: plugin.id,
    icon: { kind: "package", light: "assets/other.png" },
  }), /not declared/);
});

test("package contribution icon lookup rejects version replacement during decoding", async (t) => {
  const { icon, plugin, root } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let current = plugin;
  const service = new PluginContributionIconService({
    database: { getActivePlugin: () => current },
    packageStore: {
      async preparePackageRoot() {
        current = { ...plugin, activeVersion: "2.0.0" };
        return root;
      },
    },
    rasterizeIcon: async () => pngHeader(16, 16),
  });

  await assert.rejects(service.resolve({ pluginId: plugin.id, icon }), /ownership changed/);
});

test("oversized or disguised package icons fail before isolated decoding", async (t) => {
  const oversized = fixture();
  t.after(() => fs.rmSync(oversized.root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(oversized.root, "assets", "light.png"), pngHeader(16_384, 16_384));
  await assert.rejects(
    oversized.service.resolve({ pluginId: oversized.plugin.id, icon: oversized.icon }),
    /dimensions are too large/,
  );
  assert.deepEqual(oversized.rasterized, []);

  const disguised = fixture();
  t.after(() => fs.rmSync(disguised.root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(disguised.root, "assets", "light.png"), Buffer.from("GIF89a\u0001\u0000\u0001\u0000", "binary"));
  await assert.rejects(
    disguised.service.resolve({ pluginId: disguised.plugin.id, icon: disguised.icon }),
    /does not match its extension/,
  );
  assert.deepEqual(disguised.rasterized, []);
});

test("SVG preflight requires bounded declarative dimensions and rejects active content", () => {
  assert.deepEqual(inspectContributionIconSource(
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 16"><path d="M0 0h1"/></svg>'),
    ".svg",
  ), { mimeType: "image/svg+xml", width: 32, height: 16 });
  assert.throws(() => inspectContributionIconSource(
    Buffer.from('<svg width="32" height="16"><script>alert(1)</script></svg>'),
    ".svg",
  ), /header is invalid/);
});
