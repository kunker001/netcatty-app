"use strict";

if (!process.versions.electron) {
  const test = require("node:test");
  test("live Electron plugin runtimes", { skip: "run with npm run test:plugin-runtime:electron" }, () => {});
} else {
  const assert = require("node:assert/strict");
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const electron = require("electron");

  const { PLUGIN_PROTOCOL_SCHEME } = require("./constants.cjs");
  const { inspectContributionIconSource } = require("./contributionIconService.cjs");
  const { createIsolatedContributionIconRasterizer } = require("./contributionIconRasterizer.cjs");
  const { createPluginHostService } = require("./hostService.cjs");

  const appRoot = path.resolve(__dirname, "..", "..");
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-plugin-electron-smoke-"));
  electron.app.setPath("userData", userData);
  electron.app.commandLine.appendSwitch("disable-gpu");
  electron.app.on("window-all-closed", () => {});
  electron.protocol.registerSchemesAsPrivileged([{
    scheme: PLUGIN_PROTOCOL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
      codeCache: true,
    },
  }]);

  void electron.app.whenReady().then(async () => {
    const rasterizeContributionIcon = createIsolatedContributionIconRasterizer({
      BrowserWindow: electron.BrowserWindow,
    });
    const rasterizedIcon = await rasterizeContributionIcon({
      body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 64"><rect width="128" height="64" fill="red"/></svg>'),
      mimeType: "image/svg+xml",
      width: 128,
      height: 64,
      maxEdge: 64,
    });
    assert.deepEqual(inspectContributionIconSource(rasterizedIcon, ".png", 64), {
      mimeType: "image/png",
      width: 64,
      height: 32,
    });

    const { buildPluginPackage } = await import("@netcatty/plugin-cli");
    const fixtures = [
      { id: "com.netcatty.runtime-smoke-browser", kind: "browser" },
      { id: "com.netcatty.runtime-smoke-utility", kind: "utility" },
    ];
    const runtimeAppRoot = path.join(userData, "runtime-app");
    const runtimeDirectory = path.join(runtimeAppRoot, "electron", "plugins", "runtime");
    for (const packageName of ["plugin-contract", "plugin-sdk"]) {
      fs.cpSync(
        path.join(appRoot, "node_modules", "@netcatty", packageName, "dist"),
        path.join(runtimeAppRoot, "node_modules", "@netcatty", packageName, "dist"),
        { recursive: true },
      );
    }
    fs.cpSync(path.join(__dirname, "runtime"), runtimeDirectory, { recursive: true });
    const service = createPluginHostService({
      app: electron.app,
      electron,
      appRoot: runtimeAppRoot,
      runtimeDirectory,
      requestPermissionDecision: async (request) => ({
        requestId: request.requestId,
        decision: "allow",
        scope: "application",
      }),
    });
    await service.manager.initialize();
    for (const fixture of fixtures) {
      const archivePath = path.join(userData, `${fixture.id}.ncpkg`);
      await buildPluginPackage(
        path.join(__dirname, "fixtures", `${fixture.kind}-runtime-plugin`),
        archivePath,
      );
      const installed = await service.manager.install(archivePath, { enable: true });
      assert.equal(installed.id, fixture.id);
      const active = service.database.getActivePlugin(fixture.id);
      assert.equal(active.runtime.status, "running");
      assert.equal(active.runtime.kind, fixture.kind);
      assert.deepEqual(service.database.getValue(fixture.id, "smoke.activation"), {
        kind: fixture.kind,
        ready: true,
      });
    }
    await service.manager.shutdown();
    fs.rmSync(userData, { recursive: true, force: true });
    process.stdout.write("PLUGIN_RUNTIME_SMOKE_OK\n");
    electron.app.exit(0);
  }).catch(async (error) => {
    console.error(error);
    await new Promise((resolve) => setTimeout(resolve, 250));
    for (const pluginId of [
      "com.netcatty.runtime-smoke-browser",
      "com.netcatty.runtime-smoke-utility",
    ]) {
      try {
        const logPath = path.join(userData, "plugins", "logs", pluginId, "runtime.log");
        console.error(fs.readFileSync(logPath, "utf8"));
      } catch {}
    }
    if (process.env.NETCATTY_PLUGIN_SMOKE_KEEP) console.error(`Smoke data retained at ${userData}`);
    else fs.rmSync(userData, { recursive: true, force: true });
    electron.app.exit(1);
  });
}
