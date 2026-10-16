const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  beforePackCursorSdk,
} = require("./beforePackCursorSdk.cjs");
const {
  copyPatchedNodePtyToPackagedApp,
  rebuildPatchedNodePty,
} = require("./nodePtyConptyPatch.cjs");

test("beforePackCursorSdk builds Windows Hello helper only for Windows packages", () => {
  const calls = [];

  beforePackCursorSdk({
    appDir: process.cwd(),
    electronPlatformName: "win32",
    arch: 3,
    ensureCursorSdkPlatformPackages: () => [],
    buildWindowsHelloHelper: (projectDir) => calls.push(projectDir),
  });

  assert.deepEqual(calls, [{ projectDir: process.cwd(), platform: "win32", arch: "arm64" }]);

  beforePackCursorSdk({
    appDir: process.cwd(),
    electronPlatformName: "darwin",
    ensureCursorSdkPlatformPackages: () => [],
    buildWindowsHelloHelper: (projectDir) => calls.push(projectDir),
  });

  assert.deepEqual(calls, [{ projectDir: process.cwd(), platform: "win32", arch: "arm64" }]);
});

test("beforePackCursorSdk falls back to npm_config_arch for Windows Hello helper arch", () => {
  const calls = [];
  const originalArch = process.env.npm_config_arch;
  process.env.npm_config_arch = "x64";
  try {
    beforePackCursorSdk({
      appDir: process.cwd(),
      electronPlatformName: "win32",
      ensureCursorSdkPlatformPackages: () => [],
      buildWindowsHelloHelper: (projectDir) => calls.push(projectDir),
    });
  } finally {
    if (originalArch === undefined) {
      delete process.env.npm_config_arch;
    } else {
      process.env.npm_config_arch = originalArch;
    }
  }

  assert.deepEqual(calls, [{ projectDir: process.cwd(), platform: "win32", arch: "x64" }]);
});

test("beforePackCursorSdk fails Windows packaging when Windows Hello helper build is skipped", () => {
  assert.throws(
    () => beforePackCursorSdk({
      appDir: process.cwd(),
      electronPlatformName: "win32",
      ensureCursorSdkPlatformPackages: () => [],
      buildWindowsHelloHelper: () => ({ skipped: true, reason: "compiler-unavailable" }),
    }),
    /Windows Hello helper was not built: compiler-unavailable/,
  );
});

test("Windows packaging rebuilds patched node-pty from source for the target architecture", () => {
  const calls = [];
  const rebuilt = rebuildPatchedNodePty({
    projectDir: "/workspace/netcatty",
    platform: "win32",
    arch: 3,
    run: (...args) => calls.push(args),
    exists: () => true,
    logger: { log() {} },
  });

  assert.equal(rebuilt, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], process.execPath);
  assert.deepEqual(calls[0][1], [
    path.join("/workspace/netcatty", "node_modules", "@electron", "rebuild", "lib", "cli.js"),
    "--force",
    "--build-from-source",
    "--only",
    "node-pty",
    "--arch",
    "arm64",
  ]);
  assert.equal(calls[0][2].cwd, "/workspace/netcatty");
  assert.equal(calls[1][0], process.execPath);
  assert.equal(
    calls[1][1][0],
    path.join("/workspace/netcatty", "node_modules", "node-pty", "scripts", "post-install.js"),
  );
  assert.equal(calls[1][2].env.npm_config_arch, "arm64");
});

test("Windows packaging fails when rebuilt node-pty runtime files are incomplete", () => {
  assert.throws(() => rebuildPatchedNodePty({
    projectDir: "/workspace/netcatty",
    platform: "win32",
    arch: 1,
    run() {},
    exists: (filePath) => !filePath.endsWith("conpty.dll"),
    logger: { log() {} },
  }), /Patched node-pty artifacts missing: .*conpty\.dll/);
});

test("non-Windows packaging keeps the prebuilt node-pty path", () => {
  const calls = [];
  const rebuilt = rebuildPatchedNodePty({
    projectDir: "/workspace/netcatty",
    platform: "linux",
    arch: 1,
    run: (...args) => calls.push(args),
    logger: { log() {} },
  });

  assert.equal(rebuilt, false);
  assert.deepEqual(calls, []);
});

test("Windows afterPack copies rebuilt ConPTY files over packaged prebuilds", () => {
  const copied = [];
  const made = [];
  const destinations = copyPatchedNodePtyToPackagedApp({
    projectDir: "/workspace/netcatty",
    resourcesDir: "/workspace/release/resources",
    copy: (...args) => copied.push(args),
    mkdir: (...args) => made.push(args),
  });

  assert.equal(copied.length, 3);
  assert.equal(made.length, 3);
  assert.equal(copied[0][0], path.join(
    "/workspace/netcatty", "node_modules", "node-pty", "build", "Release", "conpty.node",
  ));
  assert.equal(copied[0][1], path.join(
    "/workspace/release/resources", "app.asar.unpacked", "node_modules", "node-pty", "build", "Release", "conpty.node",
  ));
  assert.deepEqual(destinations, copied.map(([, destination]) => destination));
});

test("node-pty patch matches bundled ConPTY clear ABI and preserves the cursor row", () => {
  const patch = fs.readFileSync(
    path.join(__dirname, "..", "patches", "node-pty+1.1.0.patch"),
    "utf8",
  );

  assert.match(patch, /ConptyClearPseudoConsole\(HPCON hPC, BOOL keepCursorRow\)/);
  assert.match(patch, /PFNCLEARPSEUDOCONSOLE\)\(HPCON hpc, BOOL keepCursorRow\)/);
  assert.match(patch, /pfnClearPseudoConsole\(handle->hpc, TRUE\)/);
  assert.doesNotMatch(patch, /node_modules\/node-pty\/build\//);
});
