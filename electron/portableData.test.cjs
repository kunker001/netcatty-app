const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { applyPortableDataDirectory } = require("./portableData.cjs");

function createApp({ executablePath, packaged = true }) {
  const paths = {
    exe: executablePath,
    userData: path.join(path.dirname(executablePath), "system-user-data"),
    sessionData: path.join(path.dirname(executablePath), "system-session-data"),
  };
  const writes = [];

  return {
    app: {
      isPackaged: packaged,
      getPath(name) {
        return paths[name];
      },
      setPath(name, value) {
        writes.push([name, value]);
        paths[name] = value;
      },
    },
    writes,
  };
}

test("Windows zip build uses a data directory beside Netcatty.exe when present", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-portable-data-"));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executablePath = path.join(root, "Netcatty.exe");
  const dataDirectory = path.join(root, "data");
  fs.mkdirSync(dataDirectory);
  const { app, writes } = createApp({ executablePath });

  const result = applyPortableDataDirectory({
    app,
    env: {},
    platform: "win32",
  });

  assert.deepEqual(result, {
    dataDirectory,
    source: "executable-directory",
  });
  assert.deepEqual(writes, [
    ["userData", dataDirectory],
    ["sessionData", dataDirectory],
  ]);
});

test("Windows single-file build uses data beside the portable launcher", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-portable-launcher-"));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const launcherDirectory = path.join(root, "usb-drive");
  const runtimeDirectory = path.join(root, "temporary-runtime");
  const dataDirectory = path.join(launcherDirectory, "data");
  fs.mkdirSync(dataDirectory, { recursive: true });
  fs.mkdirSync(runtimeDirectory, { recursive: true });
  const { app, writes } = createApp({
    executablePath: path.join(runtimeDirectory, "Netcatty.exe"),
  });

  const result = applyPortableDataDirectory({
    app,
    env: { PORTABLE_EXECUTABLE_DIR: launcherDirectory },
    platform: "win32",
  });

  assert.deepEqual(result, {
    dataDirectory,
    source: "portable-launcher-directory",
  });
  assert.deepEqual(writes, [
    ["userData", dataDirectory],
    ["sessionData", dataDirectory],
  ]);
});

test("Windows builds keep the system profile when no data directory is present", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-standard-data-"));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { app, writes } = createApp({
    executablePath: path.join(root, "Netcatty.exe"),
  });

  const result = applyPortableDataDirectory({
    app,
    env: { PORTABLE_EXECUTABLE_DIR: root },
    platform: "win32",
  });

  assert.equal(result, null);
  assert.deepEqual(writes, []);
});

test("development and non-Windows builds ignore a neighboring data directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-other-platform-data-"));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "data"));

  for (const options of [
    { packaged: false, platform: "win32" },
    { packaged: true, platform: "darwin" },
    { packaged: true, platform: "linux" },
  ]) {
    const { app, writes } = createApp({
      executablePath: path.join(root, "Netcatty.exe"),
      packaged: options.packaged,
    });
    const result = applyPortableDataDirectory({
      app,
      env: {},
      platform: options.platform,
    });
    assert.equal(result, null);
    assert.deepEqual(writes, []);
  }
});

test("a file named data does not enable portable mode", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-data-file-"));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "data"), "not a directory");
  const { app, writes } = createApp({
    executablePath: path.join(root, "Netcatty.exe"),
  });

  assert.equal(applyPortableDataDirectory({ app, env: {}, platform: "win32" }), null);
  assert.deepEqual(writes, []);
});
