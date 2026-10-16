const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SUPPRESSION_VALUE,
  EXPLORER_CONTEXT_MENU_SCHEMA_VERSION,
  applyInitialExplorerContextMenuPreference,
  buildExplorerContextMenuCommand,
  installExplorerContextMenu,
  isExplorerContextMenuRegistered,
  removeExplorerContextMenu,
  resolveExplorerContextMenuEnabled,
  resolveExplorerContextMenuExecutablePath,
  resolveExplorerContextMenuLaunchSpec,
  updateExplorerContextMenuEnabledPreference,
} = require("./explorerContextMenu.cjs");

test("buildExplorerContextMenuCommand puts path args after -- for Electron", () => {
  assert.equal(
    buildExplorerContextMenuCommand("C:\\Program Files\\Netcatty\\Netcatty.exe", "%1"),
    '"C:\\Program Files\\Netcatty\\Netcatty.exe" -- --open-terminal-path="%1."',
  );
  assert.equal(
    buildExplorerContextMenuCommand("C:\\Netcatty\\Netcatty.exe", "%V"),
    '"C:\\Netcatty\\Netcatty.exe" -- --open-terminal-path="%V."',
  );
  assert.equal(
    buildExplorerContextMenuCommand(
      "C:\\dev\\node_modules\\electron\\dist\\electron.exe",
      "%1",
      { appArgs: ["C:\\dev\\netcatty"] },
    ),
    '"C:\\dev\\node_modules\\electron\\dist\\electron.exe" "C:\\dev\\netcatty" -- --open-terminal-path="%1."',
  );
});

test("isExplorerContextMenuRegistered requires both folder and background verbs", () => {
  const queries = [];
  const commandByKey = {
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command":
      '"C:\\\\Apps\\\\Netcatty.exe" -- --open-terminal-path="%1."',
    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command":
      '"C:\\\\Apps\\\\Netcatty.exe" -- --open-terminal-path="%V."',
  };
  const present = new Set([
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command",
    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty",
    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command",
  ]);
  const spawnSyncImpl = (cmd, args) => {
    assert.equal(cmd, "reg.exe");
    queries.push(args.slice());
    if (args.includes("/v") && !args.includes("/ve")) {
      return { status: 1, stdout: "", stderr: "value not found" };
    }
    if (args.includes("/ve")) {
      const command = commandByKey[args[1]];
      if (command) {
        return {
          status: 0,
          stdout: `    (Default)    REG_SZ    ${command}\n`,
          stderr: "",
        };
      }
      return { status: 1, stdout: "", stderr: "value not found" };
    }
    return present.has(args[1])
      ? { status: 0, stdout: "ok", stderr: "" }
      : { status: 1, stdout: "", stderr: "not found" };
  };

  assert.equal(
    isExplorerContextMenuRegistered({ platform: "win32", spawnSyncImpl, logWarn: () => {} }),
    true,
  );
  assert.ok(queries.some((args) => args[0] === "query"));

  // Missing background verb => not fully registered.
  present.delete("HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty");
  present.delete("HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command");
  delete commandByKey["HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command"];
  assert.equal(
    isExplorerContextMenuRegistered({ platform: "win32", spawnSyncImpl, logWarn: () => {} }),
    false,
  );
});

test("isExplorerContextMenuRegistered ignores bare verb keys without command", () => {
  const spawnSyncImpl = (cmd, args) => {
    assert.equal(cmd, "reg.exe");
    if (args.includes("/v") || args.includes("/ve")) {
      // No ProgrammaticAccessOnly and no command default value.
      return { status: 1, stdout: "", stderr: "value missing" };
    }
    if (args[1] === "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty") {
      return { status: 0, stdout: "ok", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "not found" };
  };

  assert.equal(
    isExplorerContextMenuRegistered({ platform: "win32", spawnSyncImpl, logWarn: () => {} }),
    false,
  );
});

test("isExplorerContextMenuRegistered is false when user suppressed HKLM menu", () => {
  const spawnSyncImpl = (cmd, args) => {
    assert.equal(cmd, "reg.exe");
    if (args[0] !== "query") return { status: 1, stdout: "", stderr: "unexpected" };
    const key = args[1];
    if (args.includes("/v")) {
      if (
        args.includes(SUPPRESSION_VALUE)
        && (
          key === "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty"
          || key === "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty"
        )
      ) {
        return { status: 0, stdout: "ok", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "value missing" };
    }
    if (
      key === "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty"
      || key === "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty"
      || key === "HKLM\\Software\\Classes\\Directory\\shell\\Netcatty"
      || key === "HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty"
      || key.endsWith("\\command")
    ) {
      return { status: 0, stdout: "ok", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "missing" };
  };

  assert.equal(
    isExplorerContextMenuRegistered({ platform: "win32", spawnSyncImpl, logWarn: () => {} }),
    false,
  );
});

test("isExplorerContextMenuRegistered stays true when only one verb is suppressed", () => {
  const commandByKey = {
    "HKLM\\Software\\Classes\\Directory\\shell\\Netcatty\\command":
      '"C:\\\\Apps\\\\Netcatty.exe" -- --open-terminal-path="%1."',
    "HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command":
      '"C:\\\\Apps\\\\Netcatty.exe" -- --open-terminal-path="%V."',
  };
  const present = new Set([
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKLM\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKLM\\Software\\Classes\\Directory\\shell\\Netcatty\\command",
    "HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty",
    "HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command",
  ]);
  const spawnSyncImpl = (cmd, args) => {
    assert.equal(cmd, "reg.exe");
    if (args[0] !== "query") return { status: 1, stdout: "", stderr: "unexpected" };
    if (args.includes("/ve")) {
      const command = commandByKey[args[1]];
      return command
        ? { status: 0, stdout: `    (Default)    REG_SZ    ${command}\n`, stderr: "" }
        : { status: 1, stdout: "", stderr: "no value" };
    }
    if (args.includes("/v")) {
      // Only the folder verb is suppressed; background is still visible via HKLM.
      if (
        args.includes(SUPPRESSION_VALUE)
        && args[1] === "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty"
      ) {
        return { status: 0, stdout: "ok", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "value missing" };
    }
    return present.has(args[1])
      ? { status: 0, stdout: "ok", stderr: "" }
      : { status: 1, stdout: "", stderr: "missing" };
  };

  assert.equal(
    isExplorerContextMenuRegistered({ platform: "win32", spawnSyncImpl, logWarn: () => {} }),
    true,
  );
});

test("removeExplorerContextMenu deletes per-user folder and background keys", () => {
  const deleted = [];
  const present = new Set([
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty",
  ]);
  const spawnSyncImpl = (cmd, args) => {
    assert.equal(cmd, "reg.exe");
    if (args[0] === "query") {
      if (args.includes("/v")) {
        return { status: 1, stdout: "", stderr: "no value" };
      }
      return present.has(args[1])
        ? { status: 0, stdout: "ok", stderr: "" }
        : { status: 1, stdout: "", stderr: "missing" };
    }
    if (args[0] === "delete") {
      deleted.push(args[1]);
      present.delete(args[1]);
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unexpected" };
  };

  const result = removeExplorerContextMenu({
    platform: "win32",
    spawnSyncImpl,
    logWarn: () => {},
  });
  assert.equal(result.success, true);
  assert.equal(result.enabled, false);
  assert.ok(deleted.some((key) => key.endsWith("Directory\\shell\\Netcatty")));
  assert.ok(deleted.some((key) => key.includes("Directory\\Background\\shell\\Netcatty")));
  assert.ok(deleted.every((key) => key.startsWith("HKCU\\")));
});

test("removeExplorerContextMenu never deletes HKLM; suppresses per-user instead", () => {
  const present = new Set([
    "HKLM\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty",
  ]);
  const deleted = [];
  const suppressed = new Set();
  const spawnSyncImpl = (cmd, args) => {
    assert.equal(cmd, "reg.exe");
    if (args[0] === "query") {
      if (args.includes("/v")) {
        if (args.includes(SUPPRESSION_VALUE) && suppressed.has(args[1])) {
          return { status: 0, stdout: "ok", stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "no value" };
      }
      return present.has(args[1]) || suppressed.has(args[1])
        ? { status: 0, stdout: "ok", stderr: "" }
        : { status: 1, stdout: "", stderr: "missing" };
    }
    if (args[0] === "delete") {
      // Even if elevated, the toggle must not wipe machine-wide verbs.
      if (String(args[1]).startsWith("HKLM\\")) {
        throw new Error("must not delete HKLM from per-user toggle");
      }
      deleted.push(args[1]);
      present.delete(args[1]);
      suppressed.delete(args[1]);
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "add") {
      const key = args[1];
      const valueIdx = args.indexOf("/v");
      if (valueIdx >= 0 && args[valueIdx + 1] === SUPPRESSION_VALUE) {
        suppressed.add(key);
        present.add(key);
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "unexpected add" };
    }
    return { status: 1, stdout: "", stderr: "unexpected" };
  };

  const result = removeExplorerContextMenu({
    platform: "win32",
    spawnSyncImpl,
    logWarn: () => {},
  });
  assert.equal(result.success, true);
  assert.equal(result.enabled, false);
  assert.ok(suppressed.has("HKCU\\Software\\Classes\\Directory\\shell\\Netcatty"));
  assert.ok(suppressed.has("HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty"));
  // Machine keys remain for other users / uninstaller; working HKCU verbs are
  // hidden via suppression rather than deleted first.
  assert.equal(deleted.length, 0);
  assert.ok(present.has("HKLM\\Software\\Classes\\Directory\\shell\\Netcatty"));
  assert.ok(present.has("HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty"));
  assert.ok(deleted.every((key) => key.startsWith("HKCU\\")));
});

test("writeUserSuppression rollback preserves pre-existing portable HKCU commands", () => {
  const present = new Set([
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command",
    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty",
    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command",
    "HKLM\\Software\\Classes\\Directory\\shell\\Netcatty",
  ]);
  const values = new Map([
    ["HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command::", '"C:\\Portable\\Netcatty.exe" -- --open-terminal-path="%1."'],
    ["HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command::", '"C:\\Portable\\Netcatty.exe" -- --open-terminal-path="%V."'],
  ]);
  let folderSuppressWrites = 0;
  const deletedKeys = [];
  const deletedValues = [];
  const spawnSyncImpl = (cmd, args) => {
    assert.equal(cmd, "reg.exe");
    if (args[0] === "query") {
      if (args.includes("/v") || args.includes("/ve")) {
        const key = args[1];
        const valueName = args.includes("/ve") ? "" : args[args.indexOf("/v") + 1];
        const mapKey = `${key}::${valueName}`;
        if (values.has(mapKey)) {
          return {
            status: 0,
            stdout: `    ${(valueName || "(Default)").padEnd(16)}REG_SZ    ${values.get(mapKey)}\n`,
            stderr: "",
          };
        }
        return { status: 1, stdout: "", stderr: "no value" };
      }
      return present.has(args[1])
        ? { status: 0, stdout: "ok", stderr: "" }
        : { status: 1, stdout: "", stderr: "missing" };
    }
    if (args[0] === "add") {
      const key = args[1];
      const valueIdx = args.indexOf("/v");
      if (valueIdx >= 0 && args[valueIdx + 1] === SUPPRESSION_VALUE) {
        // First suppression succeeds; second fails so rollback must run.
        if (key.includes("Directory\\shell\\Netcatty") && !key.includes("Background")) {
          folderSuppressWrites += 1;
          values.set(`${key}::${SUPPRESSION_VALUE}`, "");
          return { status: 0, stdout: "", stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "access denied" };
      }
      return { status: 1, stdout: "", stderr: "unexpected add" };
    }
    if (args[0] === "delete") {
      if (args.includes("/v")) {
        const key = args[1];
        const valueName = args[args.indexOf("/v") + 1];
        deletedValues.push(`${key}::${valueName}`);
        values.delete(`${key}::${valueName}`);
        return { status: 0, stdout: "", stderr: "" };
      }
      deletedKeys.push(args[1]);
      present.delete(args[1]);
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unexpected" };
  };

  const result = removeExplorerContextMenu({
    platform: "win32",
    spawnSyncImpl,
    logWarn: () => {},
  });
  assert.equal(result.success, false);
  assert.equal(folderSuppressWrites, 1);
  assert.equal(deletedKeys.length, 0);
  assert.ok(deletedValues.some((entry) => entry.includes(SUPPRESSION_VALUE)));
  assert.equal(
    present.has("HKCU\\Software\\Classes\\Directory\\shell\\Netcatty"),
    true,
  );
  assert.equal(
    values.has("HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command::"),
    true,
  );
});

test("removeExplorerContextMenu keeps portable HKCU when machine suppression fails", () => {
  const present = new Set([
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command",
    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty",
    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command",
    "HKLM\\Software\\Classes\\Directory\\shell\\Netcatty",
  ]);
  const values = new Map([
    ["HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command::", '"C:\\Portable\\Netcatty.exe" -- --open-terminal-path="%1."'],
    ["HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command::", '"C:\\Portable\\Netcatty.exe" -- --open-terminal-path="%V."'],
  ]);
  const deleted = [];
  const spawnSyncImpl = (cmd, args) => {
    assert.equal(cmd, "reg.exe");
    if (args[0] === "query") {
      if (args.includes("/v") || args.includes("/ve")) {
        const key = args[1];
        const valueName = args.includes("/ve") ? "" : args[args.indexOf("/v") + 1];
        const mapKey = `${key}::${valueName}`;
        if (values.has(mapKey)) {
          return {
            status: 0,
            stdout: `    ${(valueName || "(Default)").padEnd(16)}REG_SZ    ${values.get(mapKey)}\n`,
            stderr: "",
          };
        }
        return { status: 1, stdout: "", stderr: "no value" };
      }
      return present.has(args[1])
        ? { status: 0, stdout: "ok", stderr: "" }
        : { status: 1, stdout: "", stderr: "missing" };
    }
    if (args[0] === "delete") {
      deleted.push(args[1]);
      present.delete(args[1]);
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "add") {
      // Suppression write fails (e.g. partial ACL / disk error).
      return { status: 1, stdout: "", stderr: "access denied" };
    }
    return { status: 1, stdout: "", stderr: "unexpected" };
  };

  const result = removeExplorerContextMenu({
    platform: "win32",
    spawnSyncImpl,
    logWarn: () => {},
  });
  assert.equal(result.success, false);
  assert.equal(deleted.length, 0);
  assert.equal(present.has("HKCU\\Software\\Classes\\Directory\\shell\\Netcatty"), true);
  assert.equal(result.enabled, true);
});

test("installExplorerContextMenu writes HKCU shell command entries", () => {
  const writes = [];
  const present = new Set();
  const values = new Map();
  const spawnSyncImpl = (cmd, args) => {
    assert.equal(cmd, "reg.exe");
    if (args[0] === "query") {
      if (args.includes("/v") || args.includes("/ve")) {
        const key = args[1];
        const valueName = args.includes("/ve") ? "" : args[args.indexOf("/v") + 1];
        const mapKey = `${key}::${valueName}`;
        if (values.has(mapKey)) {
          return {
            status: 0,
            stdout: `    ${(valueName || "(Default)").padEnd(16)}REG_SZ    ${values.get(mapKey)}\n`,
            stderr: "",
          };
        }
        return { status: 1, stdout: "", stderr: "no value" };
      }
      return present.has(args[1])
        ? { status: 0, stdout: "ok", stderr: "" }
        : { status: 1, stdout: "", stderr: "missing" };
    }
    if (args[0] === "add") {
      writes.push(args.slice());
      present.add(args[1]);
      const valueName = args.includes("/ve") ? "" : args[args.indexOf("/v") + 1];
      const dataIdx = args.indexOf("/d");
      if (dataIdx >= 0) values.set(`${args[1]}::${valueName}`, args[dataIdx + 1]);
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "delete") {
      present.delete(args[1]);
      for (const key of [...values.keys()]) {
        if (key.startsWith(`${args[1]}::`)) values.delete(key);
      }
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unexpected" };
  };

  const result = installExplorerContextMenu({
    executablePath: "C:\\Apps\\Netcatty.exe",
    platform: "win32",
    spawnSyncImpl,
    logWarn: () => {},
  });

  assert.equal(result.success, true);
  assert.equal(result.enabled, true);
  assert.ok(writes.some((args) => args.includes("MUIVerb") && args.includes("Open in Netcatty")));
  assert.ok(writes.some((args) =>
    args.some((part) => String(part).includes('--open-terminal-path="%1."'))
  ));
  assert.ok(writes.some((args) =>
    args.some((part) => String(part).includes('--open-terminal-path="%V."'))
  ));
  // Per-user only when no machine registration exists.
  assert.ok(writes.every((args) => String(args[1]).startsWith("HKCU\\")));
});

test("installExplorerContextMenu does not duplicate HKLM verbs into HKCU", () => {
  const writes = [];
  const present = new Set([
    "HKLM\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty",
  ]);
  const values = new Map();
  const spawnSyncImpl = (cmd, args) => {
    assert.equal(cmd, "reg.exe");
    if (args[0] === "query") {
      if (args.includes("/v") || args.includes("/ve")) {
        const key = args[1];
        const valueName = args.includes("/ve") ? "" : args[args.indexOf("/v") + 1];
        const mapKey = `${key}::${valueName}`;
        if (values.has(mapKey)) {
          return {
            status: 0,
            stdout: `    ${(valueName || "(Default)").padEnd(16)}REG_SZ    ${values.get(mapKey)}\n`,
            stderr: "",
          };
        }
        return { status: 1, stdout: "", stderr: "no value" };
      }
      return present.has(args[1])
        ? { status: 0, stdout: "ok", stderr: "" }
        : { status: 1, stdout: "", stderr: "missing" };
    }
    if (args[0] === "add") {
      writes.push(args.slice());
      present.add(args[1]);
      const valueName = args.includes("/ve") ? "" : args[args.indexOf("/v") + 1];
      const dataIdx = args.indexOf("/d");
      if (dataIdx >= 0) values.set(`${args[1]}::${valueName}`, args[dataIdx + 1]);
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "delete") {
      present.delete(args[1]);
      for (const key of [...values.keys()]) {
        if (key.startsWith(`${args[1]}::`)) values.delete(key);
      }
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unexpected" };
  };

  const result = installExplorerContextMenu({
    executablePath: "C:\\Program Files\\Netcatty\\Netcatty.exe",
    platform: "win32",
    spawnSyncImpl,
    logWarn: () => {},
  });

  assert.equal(result.success, true);
  assert.equal(result.enabled, true);
  assert.ok(writes.length > 0);
  assert.ok(writes.every((args) => String(args[1]).startsWith("HKLM\\")));
  assert.ok(!writes.some((args) => String(args[1]).startsWith("HKCU\\")));
});

test("installExplorerContextMenu falls back to HKCU when unelevated HKLM verbs are stale", () => {
  const exe = "C:\\Program Files\\Netcatty\\Netcatty.exe";
  const present = new Set([
    "HKLM\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKLM\\Software\\Classes\\Directory\\shell\\Netcatty\\command",
    "HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty",
    "HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command",
  ]);
  const values = new Map([
    ["HKLM\\Software\\Classes\\Directory\\shell\\Netcatty::MUIVerb", "Open in Netcatty"],
    ["HKLM\\Software\\Classes\\Directory\\shell\\Netcatty::Icon", "C:\\Old\\Netcatty.exe,0"],
    ["HKLM\\Software\\Classes\\Directory\\shell\\Netcatty\\command::", '"C:\\Old\\Netcatty.exe" --open-terminal-path "%1"'],
    ["HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty::MUIVerb", "Open in Netcatty"],
    ["HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty::Icon", "C:\\Old\\Netcatty.exe,0"],
    ["HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command::", '"C:\\Old\\Netcatty.exe" --open-terminal-path "%V"'],
  ]);
  const spawnSyncImpl = (cmd, args) => {
    assert.equal(cmd, "reg.exe");
    if (args[0] === "query") {
      if (args.includes("/v") || args.includes("/ve")) {
        const key = args[1];
        const valueName = args.includes("/ve") ? "" : args[args.indexOf("/v") + 1];
        const mapKey = `${key}::${valueName}`;
        if (values.has(mapKey)) {
          return {
            status: 0,
            stdout: `    ${(valueName || "(Default)").padEnd(16)}REG_SZ    ${values.get(mapKey)}\n`,
            stderr: "",
          };
        }
        return { status: 1, stdout: "", stderr: "no value" };
      }
      return present.has(args[1])
        ? { status: 0, stdout: "ok", stderr: "" }
        : { status: 1, stdout: "", stderr: "missing" };
    }
    if (args[0] === "add") {
      const key = args[1];
      // Unelevated process cannot rewrite HKLM; HKCU fallback must succeed.
      if (String(key).startsWith("HKLM\\")) {
        return { status: 1, stdout: "", stderr: "access denied" };
      }
      present.add(key);
      const valueName = args.includes("/ve") ? "" : args[args.indexOf("/v") + 1];
      const dataIdx = args.indexOf("/d");
      if (dataIdx >= 0) values.set(`${key}::${valueName}`, args[dataIdx + 1]);
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "delete") {
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unexpected" };
  };

  const result = installExplorerContextMenu({
    executablePath: exe,
    platform: "win32",
    spawnSyncImpl,
    logWarn: () => {},
  });
  assert.equal(result.success, true);
  assert.equal(result.enabled, true);
  assert.equal(
    values.get("HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command::"),
    buildExplorerContextMenuCommand(exe, "%1"),
  );
});

test("installExplorerContextMenu skips reg writes when shell verbs are already current", () => {
  const exe = "C:\\Program Files\\Netcatty\\Netcatty.exe";
  const folderCmd = buildExplorerContextMenuCommand(exe, "%1");
  const backgroundCmd = buildExplorerContextMenuCommand(exe, "%V");
  const present = new Set([
    "HKLM\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKLM\\Software\\Classes\\Directory\\shell\\Netcatty\\command",
    "HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty",
    "HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command",
  ]);
  const values = new Map([
    ["HKLM\\Software\\Classes\\Directory\\shell\\Netcatty::MUIVerb", "Open in Netcatty"],
    ["HKLM\\Software\\Classes\\Directory\\shell\\Netcatty::Icon", `${exe},0`],
    ["HKLM\\Software\\Classes\\Directory\\shell\\Netcatty\\command::", folderCmd],
    ["HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty::MUIVerb", "Open in Netcatty"],
    ["HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty::Icon", `${exe},0`],
    ["HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command::", backgroundCmd],
  ]);
  const writes = [];
  const spawnSyncImpl = (cmd, args) => {
    assert.equal(cmd, "reg.exe");
    if (args[0] === "query") {
      if (args.includes("/v") || args.includes("/ve")) {
        const key = args[1];
        const valueName = args.includes("/ve") ? "" : args[args.indexOf("/v") + 1];
        const mapKey = `${key}::${valueName}`;
        if (values.has(mapKey)) {
          return {
            status: 0,
            stdout: `    ${(valueName || "(Default)").padEnd(16)}REG_SZ    ${values.get(mapKey)}\n`,
            stderr: "",
          };
        }
        return { status: 1, stdout: "", stderr: "no value" };
      }
      return present.has(args[1])
        ? { status: 0, stdout: "ok", stderr: "" }
        : { status: 1, stdout: "", stderr: "missing" };
    }
    if (args[0] === "add") {
      writes.push(args.slice());
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "delete") {
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unexpected" };
  };

  const result = installExplorerContextMenu({
    executablePath: exe,
    platform: "win32",
    spawnSyncImpl,
    logWarn: () => {},
  });

  assert.equal(result.success, true);
  assert.equal(result.enabled, true);
  assert.equal(writes.length, 0);
});

test("resolveExplorerContextMenuEnabled prefers saved preference over registry", () => {
  const fsModule = {
    existsSync: () => true,
    readFileSync: () => JSON.stringify({ enabled: false }),
  };
  const app = { getPath: () => "C:\\Users\\test\\AppData\\Roaming\\Netcatty" };
  const spawnSyncImpl = () => ({ status: 0, stdout: "present", stderr: "" });

  const resolved = resolveExplorerContextMenuEnabled({
    app,
    platform: "win32",
    fsModule,
    spawnSyncImpl,
    logWarn: () => {},
  });
  assert.deepEqual(resolved, { enabled: false, supported: true });
});

test("updateExplorerContextMenuEnabledPreference rolls back apply on write failure", () => {
  const applied = [];
  const result = updateExplorerContextMenuEnabledPreference({
    currentEnabled: true,
    enabled: false,
    applyPreference: (next) => {
      applied.push(next);
      return { success: true, enabled: next };
    },
    writePreference: () => false,
  });
  assert.equal(result.success, false);
  assert.deepEqual(applied, [false, true]);
  assert.equal(result.enabled, true);
});

test("updateExplorerContextMenuEnabledPreference rolls back registry on apply failure", () => {
  const applied = [];
  const result = updateExplorerContextMenuEnabledPreference({
    currentEnabled: true,
    enabled: false,
    applyPreference: (next) => {
      applied.push(next);
      if (next === false) return { success: false, enabled: true, supported: true };
      return { success: true, enabled: true, supported: true };
    },
    writePreference: () => true,
  });
  assert.equal(result.success, false);
  assert.deepEqual(applied, [false, true]);
  assert.equal(result.enabled, true);
});

test("installExplorerContextMenu clears stale portable HKCU verbs when HKLM exists", () => {
  const exe = "C:\\Program Files\\Netcatty\\Netcatty.exe";
  const folderCmd = buildExplorerContextMenuCommand(exe, "%1");
  const backgroundCmd = buildExplorerContextMenuCommand(exe, "%V");
  const present = new Set([
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command",
    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty",
    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command",
    "HKLM\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKLM\\Software\\Classes\\Directory\\shell\\Netcatty\\command",
    "HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty",
    "HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command",
  ]);
  const values = new Map([
    ["HKCU\\Software\\Classes\\Directory\\shell\\Netcatty::MUIVerb", "Open in Netcatty"],
    ["HKCU\\Software\\Classes\\Directory\\shell\\Netcatty::Icon", "C:\\Portable\\Netcatty.exe,0"],
    ["HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command::", '"C:\\Portable\\Netcatty.exe" -- --open-terminal-path="%1."'],
    ["HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty::MUIVerb", "Open in Netcatty"],
    ["HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty::Icon", "C:\\Portable\\Netcatty.exe,0"],
    ["HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command::", '"C:\\Portable\\Netcatty.exe" -- --open-terminal-path="%V."'],
    ["HKLM\\Software\\Classes\\Directory\\shell\\Netcatty::MUIVerb", "Open in Netcatty"],
    ["HKLM\\Software\\Classes\\Directory\\shell\\Netcatty::Icon", `${exe},0`],
    ["HKLM\\Software\\Classes\\Directory\\shell\\Netcatty\\command::", folderCmd],
    ["HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty::MUIVerb", "Open in Netcatty"],
    ["HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty::Icon", `${exe},0`],
    ["HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command::", backgroundCmd],
  ]);
  const deleted = [];
  const spawnSyncImpl = (cmd, args) => {
    assert.equal(cmd, "reg.exe");
    if (args[0] === "query") {
      if (args.includes("/v") || args.includes("/ve")) {
        const key = args[1];
        const valueName = args.includes("/ve") ? "" : args[args.indexOf("/v") + 1];
        const mapKey = `${key}::${valueName}`;
        if (values.has(mapKey)) {
          return {
            status: 0,
            stdout: `    ${(valueName || "(Default)").padEnd(16)}REG_SZ    ${values.get(mapKey)}\n`,
            stderr: "",
          };
        }
        return { status: 1, stdout: "", stderr: "no value" };
      }
      return present.has(args[1])
        ? { status: 0, stdout: "ok", stderr: "" }
        : { status: 1, stdout: "", stderr: "missing" };
    }
    if (args[0] === "delete") {
      deleted.push(args[1]);
      present.delete(args[1]);
      for (const key of [...values.keys()]) {
        if (key.startsWith(`${args[1]}::`)) values.delete(key);
      }
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "add") {
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unexpected" };
  };

  const result = installExplorerContextMenu({
    executablePath: exe,
    platform: "win32",
    spawnSyncImpl,
    logWarn: () => {},
  });

  assert.equal(result.success, true);
  assert.equal(result.enabled, true);
  assert.ok(deleted.some((key) => key.includes("HKCU\\") && key.includes("Directory\\shell\\Netcatty")));
  assert.ok(deleted.some((key) => key.includes("HKCU\\") && key.includes("Directory\\Background\\shell\\Netcatty")));
  assert.equal(present.has("HKCU\\Software\\Classes\\Directory\\shell\\Netcatty"), false);
});

test("installExplorerContextMenu unsuppresses portable HKCU when HKLM refresh fails", () => {
  const present = new Set([
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command",
    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty",
    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command",
    "HKLM\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKLM\\Software\\Classes\\Directory\\shell\\Netcatty\\command",
  ]);
  const values = new Map([
    [`HKCU\\Software\\Classes\\Directory\\shell\\Netcatty::${SUPPRESSION_VALUE}`, ""],
    ["HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command::", '"C:\\Portable\\Netcatty.exe" -- --open-terminal-path="%1."'],
    [`HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty::${SUPPRESSION_VALUE}`, ""],
    ["HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command::", '"C:\\Portable\\Netcatty.exe" -- --open-terminal-path="%V."'],
    ["HKLM\\Software\\Classes\\Directory\\shell\\Netcatty\\command::", '"C:\\Old\\Netcatty.exe" --open-terminal-path "%1"'],
  ]);
  const deletedValues = [];
  const deletedKeys = [];
  const spawnSyncImpl = (cmd, args) => {
    assert.equal(cmd, "reg.exe");
    if (args[0] === "query") {
      if (args.includes("/v") || args.includes("/ve")) {
        const key = args[1];
        const valueName = args.includes("/ve") ? "" : args[args.indexOf("/v") + 1];
        const mapKey = `${key}::${valueName}`;
        if (values.has(mapKey)) {
          return {
            status: 0,
            stdout: `    ${(valueName || "(Default)").padEnd(16)}REG_SZ    ${values.get(mapKey)}\n`,
            stderr: "",
          };
        }
        return { status: 1, stdout: "", stderr: "no value" };
      }
      return present.has(args[1])
        ? { status: 0, stdout: "ok", stderr: "" }
        : { status: 1, stdout: "", stderr: "missing" };
    }
    if (args[0] === "add") {
      return { status: 1, stdout: "", stderr: "access denied" };
    }
    if (args[0] === "delete") {
      if (args.includes("/v")) {
        const key = args[1];
        const valueName = args[args.indexOf("/v") + 1];
        deletedValues.push(`${key}::${valueName}`);
        values.delete(`${key}::${valueName}`);
        return { status: 0, stdout: "", stderr: "" };
      }
      deletedKeys.push(args[1]);
      present.delete(args[1]);
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unexpected" };
  };

  const result = installExplorerContextMenu({
    executablePath: "C:\\Program Files\\Netcatty\\Netcatty.exe",
    platform: "win32",
    spawnSyncImpl,
    logWarn: () => {},
  });
  assert.equal(result.success, false);
  assert.equal(deletedKeys.length, 0);
  assert.ok(deletedValues.every((entry) => entry.includes(SUPPRESSION_VALUE)));
  assert.equal(result.enabled, true);
  assert.equal(
    values.has("HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command::"),
    true,
  );
});

test("installExplorerContextMenu keeps working HKCU when HKLM refresh fails", () => {
  const portableCmd = '"C:\\Portable\\Netcatty.exe" -- --open-terminal-path="%1."';
  const portableBg = '"C:\\Portable\\Netcatty.exe" -- --open-terminal-path="%V."';
  const present = new Set([
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command",
    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty",
    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command",
    "HKLM\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKLM\\Software\\Classes\\Directory\\shell\\Netcatty\\command",
    "HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty",
    "HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command",
  ]);
  const values = new Map([
    ["HKCU\\Software\\Classes\\Directory\\shell\\Netcatty::MUIVerb", "Open in Netcatty"],
    ["HKCU\\Software\\Classes\\Directory\\shell\\Netcatty::Icon", "C:\\Portable\\Netcatty.exe,0"],
    ["HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command::", portableCmd],
    ["HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty::MUIVerb", "Open in Netcatty"],
    ["HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty::Icon", "C:\\Portable\\Netcatty.exe,0"],
    ["HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command::", portableBg],
    ["HKLM\\Software\\Classes\\Directory\\shell\\Netcatty::MUIVerb", "Open in Netcatty"],
    ["HKLM\\Software\\Classes\\Directory\\shell\\Netcatty::Icon", "C:\\Old\\Netcatty.exe,0"],
    ["HKLM\\Software\\Classes\\Directory\\shell\\Netcatty\\command::", '"C:\\Old\\Netcatty.exe" --open-terminal-path "%1"'],
    ["HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty::MUIVerb", "Open in Netcatty"],
    ["HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty::Icon", "C:\\Old\\Netcatty.exe,0"],
    ["HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command::", '"C:\\Old\\Netcatty.exe" --open-terminal-path "%V"'],
  ]);
  const deleted = [];
  const spawnSyncImpl = (cmd, args) => {
    assert.equal(cmd, "reg.exe");
    if (args[0] === "query") {
      if (args.includes("/v") || args.includes("/ve")) {
        const key = args[1];
        const valueName = args.includes("/ve") ? "" : args[args.indexOf("/v") + 1];
        const mapKey = `${key}::${valueName}`;
        if (values.has(mapKey)) {
          return {
            status: 0,
            stdout: `    ${(valueName || "(Default)").padEnd(16)}REG_SZ    ${values.get(mapKey)}\n`,
            stderr: "",
          };
        }
        return { status: 1, stdout: "", stderr: "no value" };
      }
      return present.has(args[1])
        ? { status: 0, stdout: "ok", stderr: "" }
        : { status: 1, stdout: "", stderr: "missing" };
    }
    if (args[0] === "add") {
      // Unelevated: cannot rewrite HKLM.
      return { status: 1, stdout: "", stderr: "access denied" };
    }
    if (args[0] === "delete") {
      deleted.push(args[1]);
      present.delete(args[1]);
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unexpected" };
  };

  const result = installExplorerContextMenu({
    executablePath: "C:\\Program Files\\Netcatty\\Netcatty.exe",
    platform: "win32",
    spawnSyncImpl,
    logWarn: () => {},
  });

  assert.equal(result.success, false);
  // Portable HKCU must remain so Explorer still has a working entry.
  assert.equal(deleted.length, 0);
  assert.equal(present.has("HKCU\\Software\\Classes\\Directory\\shell\\Netcatty"), true);
  assert.equal(result.enabled, true);
});

test("installExplorerContextMenu fails when residual HKCU verbs cannot be cleared under HKLM", () => {
  const exe = "C:\\Program Files\\Netcatty\\Netcatty.exe";
  const folderCmd = buildExplorerContextMenuCommand(exe, "%1");
  const backgroundCmd = buildExplorerContextMenuCommand(exe, "%V");
  const present = new Set([
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command",
    "HKLM\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKLM\\Software\\Classes\\Directory\\shell\\Netcatty\\command",
    "HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty",
    "HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command",
  ]);
  const values = new Map([
    ["HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command::", '"C:\\Portable\\Netcatty.exe" -- --open-terminal-path="%1."'],
    ["HKLM\\Software\\Classes\\Directory\\shell\\Netcatty::MUIVerb", "Open in Netcatty"],
    ["HKLM\\Software\\Classes\\Directory\\shell\\Netcatty::Icon", `${exe},0`],
    ["HKLM\\Software\\Classes\\Directory\\shell\\Netcatty\\command::", folderCmd],
    ["HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty::MUIVerb", "Open in Netcatty"],
    ["HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty::Icon", `${exe},0`],
    ["HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command::", backgroundCmd],
  ]);
  const spawnSyncImpl = (cmd, args) => {
    assert.equal(cmd, "reg.exe");
    if (args[0] === "query") {
      if (args.includes("/v") || args.includes("/ve")) {
        const key = args[1];
        const valueName = args.includes("/ve") ? "" : args[args.indexOf("/v") + 1];
        const mapKey = `${key}::${valueName}`;
        if (values.has(mapKey)) {
          return {
            status: 0,
            stdout: `    ${(valueName || "(Default)").padEnd(16)}REG_SZ    ${values.get(mapKey)}\n`,
            stderr: "",
          };
        }
        return { status: 1, stdout: "", stderr: "no value" };
      }
      return present.has(args[1])
        ? { status: 0, stdout: "ok", stderr: "" }
        : { status: 1, stdout: "", stderr: "missing" };
    }
    if (args[0] === "delete") {
      // Simulate locked residual portable HKCU verb.
      if (String(args[1]).startsWith("HKCU\\")) {
        return { status: 1, stdout: "", stderr: "access denied" };
      }
      present.delete(args[1]);
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "add") {
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unexpected" };
  };

  const result = installExplorerContextMenu({
    executablePath: exe,
    platform: "win32",
    spawnSyncImpl,
    logWarn: () => {},
  });

  assert.equal(result.success, false);
});

test("installExplorerContextMenu fails when suppression cleanup fails on user-scope enable", () => {
  const present = new Set([
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty",
  ]);
  const values = new Map([
    [`HKCU\\Software\\Classes\\Directory\\shell\\Netcatty::${SUPPRESSION_VALUE}`, ""],
    [`HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty::${SUPPRESSION_VALUE}`, ""],
  ]);
  const spawnSyncImpl = (cmd, args) => {
    assert.equal(cmd, "reg.exe");
    if (args[0] === "query") {
      if (args.includes("/v") || args.includes("/ve")) {
        const key = args[1];
        const valueName = args.includes("/ve") ? "" : args[args.indexOf("/v") + 1];
        const mapKey = `${key}::${valueName}`;
        if (values.has(mapKey)) {
          return {
            status: 0,
            stdout: `    ${(valueName || "(Default)").padEnd(16)}REG_SZ    ${values.get(mapKey)}\n`,
            stderr: "",
          };
        }
        return { status: 1, stdout: "", stderr: "no value" };
      }
      return present.has(args[1])
        ? { status: 0, stdout: "ok", stderr: "" }
        : { status: 1, stdout: "", stderr: "missing" };
    }
    if (args[0] === "delete") {
      return { status: 1, stdout: "", stderr: "access denied" };
    }
    if (args[0] === "add") {
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unexpected" };
  };

  const result = installExplorerContextMenu({
    executablePath: "C:\\Apps\\Netcatty.exe",
    platform: "win32",
    spawnSyncImpl,
    logWarn: () => {},
  });
  assert.equal(result.success, false);
});

test("installExplorerContextMenu falls back to HKCU when only a partial HKLM verb remains", () => {
  const exe = "C:\\Program Files\\Netcatty\\Netcatty.exe";
  const present = new Set([
    "HKLM\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKLM\\Software\\Classes\\Directory\\shell\\Netcatty\\command",
  ]);
  const values = new Map([
    ["HKLM\\Software\\Classes\\Directory\\shell\\Netcatty\\command::", '"C:\\Old\\Netcatty.exe" --open-terminal-path "%1"'],
  ]);
  const spawnSyncImpl = (cmd, args) => {
    assert.equal(cmd, "reg.exe");
    if (args[0] === "query") {
      if (args.includes("/v") || args.includes("/ve")) {
        const key = args[1];
        const valueName = args.includes("/ve") ? "" : args[args.indexOf("/v") + 1];
        const mapKey = `${key}::${valueName}`;
        if (values.has(mapKey)) {
          return {
            status: 0,
            stdout: `    ${(valueName || "(Default)").padEnd(16)}REG_SZ    ${values.get(mapKey)}\n`,
            stderr: "",
          };
        }
        return { status: 1, stdout: "", stderr: "no value" };
      }
      return present.has(args[1])
        ? { status: 0, stdout: "ok", stderr: "" }
        : { status: 1, stdout: "", stderr: "missing" };
    }
    if (args[0] === "add") {
      const key = args[1];
      if (String(key).startsWith("HKLM\\")) {
        return { status: 1, stdout: "", stderr: "access denied" };
      }
      present.add(key);
      const valueName = args.includes("/ve") ? "" : args[args.indexOf("/v") + 1];
      const dataIdx = args.indexOf("/d");
      if (dataIdx >= 0) values.set(`${key}::${valueName}`, args[dataIdx + 1]);
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "delete") {
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unexpected" };
  };

  const result = installExplorerContextMenu({
    executablePath: exe,
    platform: "win32",
    spawnSyncImpl,
    logWarn: () => {},
  });
  assert.equal(result.success, true);
  assert.equal(result.enabled, true);
  assert.equal(
    values.get("HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command::"),
    buildExplorerContextMenuCommand(exe, "%1"),
  );
});

test("applyInitialExplorerContextMenuPreference caches default-off via probe marker only", () => {
  const wrote = [];
  const fsModule = {
    existsSync: () => false,
    mkdirSync: () => {},
    writeFileSync: (filePath, data) => {
      wrote.push({ filePath: String(filePath), data: JSON.parse(String(data)) });
    },
  };
  const result = applyInitialExplorerContextMenuPreference({
    app: { getPath: () => "C:\\Users\\test\\AppData\\Roaming\\Netcatty" },
    executablePath: "D:\\Tools\\NetcattyPortable.exe",
    platform: "win32",
    fsModule,
    spawnSyncImpl: () => ({ status: 1, stdout: "", stderr: "missing" }),
    logWarn: () => {},
  });
  assert.deepEqual(result, { enabled: false, success: true, supported: true });
  assert.equal(wrote.length, 1);
  assert.match(wrote[0].filePath, /explorer-context-menu-probe\.json$/);
  assert.equal(wrote[0].data.schemaVersion, EXPLORER_CONTEXT_MENU_SCHEMA_VERSION);
  assert.equal(Object.hasOwn(wrote[0].data, "enabled"), false);
});

test("applyInitialExplorerContextMenuPreference repairs per-user HKCU verbs after probe", () => {
  const exe = "C:\\Users\\me\\AppData\\Local\\Programs\\Netcatty\\Netcatty.exe";
  const folderCmd = buildExplorerContextMenuCommand(exe, "%1");
  const backgroundCmd = buildExplorerContextMenuCommand(exe, "%V");
  const files = new Map([
    [
      "C:\\Users\\test\\AppData\\Roaming\\Netcatty\\explorer-context-menu-probe.json",
      JSON.stringify({ schemaVersion: EXPLORER_CONTEXT_MENU_SCHEMA_VERSION }),
    ],
  ]);
  const present = new Set([
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command",
    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty",
    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command",
  ]);
  const values = new Map([
    ["HKCU\\Software\\Classes\\Directory\\shell\\Netcatty::MUIVerb", "Open in Netcatty"],
    ["HKCU\\Software\\Classes\\Directory\\shell\\Netcatty::Icon", `${exe},0`],
    ["HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command::", folderCmd],
    ["HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty::MUIVerb", "Open in Netcatty"],
    ["HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty::Icon", `${exe},0`],
    ["HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command::", backgroundCmd],
  ]);
  let wrotePreference = null;
  const fsModule = {
    existsSync: (p) => files.has(String(p)),
    readFileSync: (p) => files.get(String(p)),
    mkdirSync: () => {},
    writeFileSync: (p, data) => {
      files.set(String(p), String(data));
      if (String(p).endsWith("explorer-context-menu-preferences.json")) {
        wrotePreference = JSON.parse(String(data));
      }
    },
  };
  const spawnSyncImpl = (cmd, args) => {
    assert.equal(cmd, "reg.exe");
    if (args[0] === "query") {
      if (args.includes("/v") || args.includes("/ve")) {
        const key = args[1];
        const valueName = args.includes("/ve") ? "" : args[args.indexOf("/v") + 1];
        const mapKey = `${key}::${valueName}`;
        if (values.has(mapKey)) {
          return {
            status: 0,
            stdout: `    ${(valueName || "(Default)").padEnd(16)}REG_SZ    ${values.get(mapKey)}\n`,
            stderr: "",
          };
        }
        return { status: 1, stdout: "", stderr: "no value" };
      }
      return present.has(args[1])
        ? { status: 0, stdout: "ok", stderr: "" }
        : { status: 1, stdout: "", stderr: "missing" };
    }
    if (args[0] === "add" || args[0] === "delete") {
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unexpected" };
  };

  const result = applyInitialExplorerContextMenuPreference({
    app: { getPath: () => "C:\\Users\\test\\AppData\\Roaming\\Netcatty" },
    executablePath: exe,
    platform: "win32",
    fsModule,
    spawnSyncImpl,
    logWarn: () => {},
  });
  assert.equal(result.success, true);
  assert.equal(result.enabled, true);
  assert.equal(wrotePreference?.enabled, true);
});

test("resolveExplorerContextMenuLaunchSpec includes dev app entry for electron.exe", () => {
  const spec = resolveExplorerContextMenuLaunchSpec({
    execPath: "C:\\dev\\node_modules\\electron\\dist\\electron.exe",
    env: {},
    argv: [
      "C:\\dev\\node_modules\\electron\\dist\\electron.exe",
      "C:\\dev\\netcatty",
    ],
    defaultApp: true,
    pathModule: {
      resolve: (value) => value,
    },
  });
  assert.equal(spec.executablePath, "C:\\dev\\node_modules\\electron\\dist\\electron.exe");
  assert.deepEqual(spec.appArgs, ["C:\\dev\\netcatty"]);
});

test("non-windows platforms report unsupported explorer context menu", () => {
  assert.equal(
    isExplorerContextMenuRegistered({ platform: "darwin", spawnSyncImpl: () => {
      throw new Error("should not run");
    } }),
    false,
  );
  const removed = removeExplorerContextMenu({ platform: "linux" });
  assert.equal(removed.supported, false);
  assert.equal(removed.enabled, false);
});

test("resolveExplorerContextMenuExecutablePath prefers portable launcher path", () => {
  assert.equal(
    resolveExplorerContextMenuExecutablePath({
      execPath: "C:\\Users\\me\\AppData\\Local\\Temp\\ncaXXXX\\Netcatty.exe",
      env: { PORTABLE_EXECUTABLE_FILE: "D:\\Tools\\NetcattyPortable.exe" },
    }),
    "D:\\Tools\\NetcattyPortable.exe",
  );
  assert.equal(
    resolveExplorerContextMenuExecutablePath({
      execPath: "C:\\Program Files\\Netcatty\\Netcatty.exe",
      env: {},
    }),
    "C:\\Program Files\\Netcatty\\Netcatty.exe",
  );
});

test("applyInitialExplorerContextMenuPreference warm-starts when verbs remain registered", () => {
  const exe = "D:\\Tools\\NetcattyPortable.exe";
  const folderCmd = buildExplorerContextMenuCommand(exe, "%1");
  const backgroundCmd = buildExplorerContextMenuCommand(exe, "%V");
  const present = new Set([
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command",
    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty",
    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command",
  ]);
  const values = new Map([
    ["HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command::", folderCmd],
    ["HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command::", backgroundCmd],
  ]);
  let writes = 0;
  const fsModule = {
    existsSync: () => true,
    readFileSync: () => JSON.stringify({
      enabled: true,
      schemaVersion: EXPLORER_CONTEXT_MENU_SCHEMA_VERSION,
      executablePath: exe,
    }),
    mkdirSync: () => {
      throw new Error("should not write preference on healthy warm start");
    },
    writeFileSync: () => {
      throw new Error("should not write preference on healthy warm start");
    },
  };
  const spawnSyncImpl = (cmd, args) => {
    assert.equal(cmd, "reg.exe");
    if (args[0] === "add" || args[0] === "delete") {
      writes += 1;
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "query") {
      if (args.includes("/v") || args.includes("/ve")) {
        const key = args[1];
        const valueName = args.includes("/ve") ? "" : args[args.indexOf("/v") + 1];
        const mapKey = `${key}::${valueName}`;
        if (values.has(mapKey)) {
          return {
            status: 0,
            stdout: `    ${(valueName || "(Default)").padEnd(16)}REG_SZ    ${values.get(mapKey)}\n`,
            stderr: "",
          };
        }
        return { status: 1, stdout: "", stderr: "no value" };
      }
      return present.has(args[1])
        ? { status: 0, stdout: "ok", stderr: "" }
        : { status: 1, stdout: "", stderr: "missing" };
    }
    return { status: 1, stdout: "", stderr: "unexpected" };
  };
  const result = applyInitialExplorerContextMenuPreference({
    app: { getPath: () => "C:\\Users\\test\\AppData\\Roaming\\Netcatty" },
    executablePath: exe,
    platform: "win32",
    fsModule,
    spawnSyncImpl,
    logWarn: () => {},
  });
  assert.deepEqual(result, { enabled: true, success: true, supported: true });
  assert.equal(writes, 0);
});

test("applyInitialExplorerContextMenuPreference re-applies when enabled preference has missing verbs", () => {
  const exe = "D:\\Tools\\NetcattyPortable.exe";
  let wrote = null;
  const present = new Set([
    // Only one verb remains after an interrupted rewrite.
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command",
  ]);
  const values = new Map([
    ["HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command::", buildExplorerContextMenuCommand(exe, "%1")],
  ]);
  const fsModule = {
    existsSync: () => true,
    readFileSync: () => JSON.stringify({
      enabled: true,
      schemaVersion: EXPLORER_CONTEXT_MENU_SCHEMA_VERSION,
      executablePath: exe,
    }),
    mkdirSync: () => {},
    writeFileSync: (_p, data) => {
      wrote = JSON.parse(String(data));
    },
  };
  const spawnSyncImpl = (cmd, args) => {
    assert.equal(cmd, "reg.exe");
    if (args[0] === "query") {
      if (args.includes("/v") || args.includes("/ve")) {
        const key = args[1];
        const valueName = args.includes("/ve") ? "" : args[args.indexOf("/v") + 1];
        const mapKey = `${key}::${valueName}`;
        if (values.has(mapKey)) {
          return {
            status: 0,
            stdout: `    ${(valueName || "(Default)").padEnd(16)}REG_SZ    ${values.get(mapKey)}\n`,
            stderr: "",
          };
        }
        return { status: 1, stdout: "", stderr: "no value" };
      }
      return present.has(args[1])
        ? { status: 0, stdout: "ok", stderr: "" }
        : { status: 1, stdout: "", stderr: "missing" };
    }
    if (args[0] === "add") {
      const key = args[1];
      present.add(key);
      const valueName = args.includes("/ve") ? "" : args[args.indexOf("/v") + 1];
      const dataIdx = args.indexOf("/d");
      if (dataIdx >= 0) values.set(`${key}::${valueName}`, args[dataIdx + 1]);
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "delete") {
      present.delete(args[1]);
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unexpected" };
  };
  const result = applyInitialExplorerContextMenuPreference({
    app: { getPath: () => "C:\\Users\\test\\AppData\\Roaming\\Netcatty" },
    executablePath: exe,
    platform: "win32",
    fsModule,
    spawnSyncImpl,
    logWarn: () => {},
  });
  assert.equal(result.success, true);
  assert.equal(result.enabled, true);
  assert.equal(wrote?.enabled, true);
});

test("applyInitialExplorerContextMenuPreference re-suppresses when preference is disabled", () => {
  let wrote = null;
  const present = new Set([
    "HKLM\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKLM\\Software\\Classes\\Directory\\Background\\shell\\Netcatty",
  ]);
  const suppressed = new Set();
  const fsModule = {
    existsSync: () => true,
    readFileSync: () => JSON.stringify({
      enabled: false,
      schemaVersion: EXPLORER_CONTEXT_MENU_SCHEMA_VERSION,
      executablePath: "C:\\Program Files\\Netcatty\\Netcatty.exe",
    }),
    mkdirSync: () => {},
    writeFileSync: (_path, data) => {
      wrote = JSON.parse(String(data));
    },
  };
  const spawnSyncImpl = (cmd, args) => {
    assert.equal(cmd, "reg.exe");
    if (args[0] === "query") {
      if (args.includes("/v")) {
        if (args.includes(SUPPRESSION_VALUE) && suppressed.has(args[1])) {
          return { status: 0, stdout: "ok", stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "no value" };
      }
      return present.has(args[1]) || suppressed.has(args[1])
        ? { status: 0, stdout: "ok", stderr: "" }
        : { status: 1, stdout: "", stderr: "missing" };
    }
    if (args[0] === "delete") {
      present.delete(args[1]);
      suppressed.delete(args[1]);
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "add") {
      const valueIdx = args.indexOf("/v");
      if (valueIdx >= 0 && args[valueIdx + 1] === SUPPRESSION_VALUE) {
        suppressed.add(args[1]);
        present.add(args[1]);
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "unexpected add" };
    }
    return { status: 1, stdout: "", stderr: "unexpected" };
  };

  const result = applyInitialExplorerContextMenuPreference({
    app: { getPath: () => "C:\\Users\\test\\AppData\\Roaming\\Netcatty" },
    executablePath: "C:\\Program Files\\Netcatty\\Netcatty.exe",
    platform: "win32",
    fsModule,
    spawnSyncImpl,
    logWarn: () => {},
  });
  assert.equal(result.success, true);
  assert.equal(result.enabled, false);
  assert.equal(wrote?.enabled, false);
  assert.ok(suppressed.has("HKCU\\Software\\Classes\\Directory\\shell\\Netcatty"));
  assert.ok(suppressed.has("HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty"));
});

test("applyInitialExplorerContextMenuPreference re-applies when development appArgs change", () => {
  const electronExe = "C:\\dev\\node_modules\\electron\\dist\\electron.exe";
  const oldApp = "C:\\old\\netcatty";
  const newApp = "C:\\new\\netcatty";
  let wrote = null;
  const present = new Set([
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty",
    "HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command",
    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty",
    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command",
  ]);
  const values = new Map([
    ["HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command::", buildExplorerContextMenuCommand(electronExe, "%1", { appArgs: [oldApp] })],
    ["HKCU\\Software\\Classes\\Directory\\Background\\shell\\Netcatty\\command::", buildExplorerContextMenuCommand(electronExe, "%V", { appArgs: [oldApp] })],
  ]);
  const fsModule = {
    existsSync: () => true,
    readFileSync: () => JSON.stringify({
      enabled: true,
      schemaVersion: EXPLORER_CONTEXT_MENU_SCHEMA_VERSION,
      executablePath: electronExe,
      appArgs: [oldApp],
    }),
    mkdirSync: () => {},
    writeFileSync: (_p, data) => {
      wrote = JSON.parse(String(data));
    },
  };
  const spawnSyncImpl = (cmd, args) => {
    assert.equal(cmd, "reg.exe");
    if (args[0] === "query") {
      if (args.includes("/v") || args.includes("/ve")) {
        const key = args[1];
        const valueName = args.includes("/ve") ? "" : args[args.indexOf("/v") + 1];
        const mapKey = `${key}::${valueName}`;
        if (values.has(mapKey)) {
          return {
            status: 0,
            stdout: `    ${(valueName || "(Default)").padEnd(16)}REG_SZ    ${values.get(mapKey)}\n`,
            stderr: "",
          };
        }
        return { status: 1, stdout: "", stderr: "no value" };
      }
      return present.has(args[1])
        ? { status: 0, stdout: "ok", stderr: "" }
        : { status: 1, stdout: "", stderr: "missing" };
    }
    if (args[0] === "add") {
      const key = args[1];
      const valueName = args.includes("/ve") ? "" : args[args.indexOf("/v") + 1];
      const dataIdx = args.indexOf("/d");
      if (dataIdx >= 0) values.set(`${key}::${valueName}`, args[dataIdx + 1]);
      present.add(key);
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "delete") {
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unexpected" };
  };

  const result = applyInitialExplorerContextMenuPreference({
    app: { getPath: () => "C:\\Users\\test\\AppData\\Roaming\\Netcatty" },
    executablePath: electronExe,
    appArgs: [newApp],
    platform: "win32",
    fsModule,
    spawnSyncImpl,
    logWarn: () => {},
  });
  assert.equal(result.success, true);
  assert.equal(result.enabled, true);
  assert.deepEqual(wrote?.appArgs, [newApp]);
  assert.equal(
    values.get("HKCU\\Software\\Classes\\Directory\\shell\\Netcatty\\command::"),
    buildExplorerContextMenuCommand(electronExe, "%1", { appArgs: [newApp] }),
  );
});

test("applyInitialExplorerContextMenuPreference re-applies when portable path changes", () => {
  let wrote = null;
  const present = new Set();
  const values = new Map();
  const fsModule = {
    existsSync: () => true,
    readFileSync: () => JSON.stringify({
      enabled: true,
      schemaVersion: EXPLORER_CONTEXT_MENU_SCHEMA_VERSION,
      executablePath: "D:\\Old\\NetcattyPortable.exe",
    }),
    mkdirSync: () => {},
    writeFileSync: (_path, data) => {
      wrote = JSON.parse(String(data));
    },
  };
  const spawnSyncImpl = (cmd, args) => {
    assert.equal(cmd, "reg.exe");
    if (args[0] === "query") {
      if (args.includes("/v") || args.includes("/ve")) {
        const key = args[1];
        const valueName = args.includes("/ve") ? "" : args[args.indexOf("/v") + 1];
        const mapKey = `${key}::${valueName}`;
        if (values.has(mapKey)) {
          return {
            status: 0,
            stdout: `    ${(valueName || "(Default)").padEnd(16)}REG_SZ    ${values.get(mapKey)}\n`,
            stderr: "",
          };
        }
        return { status: 1, stdout: "", stderr: "no value" };
      }
      return present.has(args[1])
        ? { status: 0, stdout: "ok", stderr: "" }
        : { status: 1, stdout: "", stderr: "missing" };
    }
    if (args[0] === "add") {
      present.add(args[1]);
      const valueName = args.includes("/ve") ? "" : args[args.indexOf("/v") + 1];
      const dataIdx = args.indexOf("/d");
      if (dataIdx >= 0) values.set(`${args[1]}::${valueName}`, args[dataIdx + 1]);
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "delete") {
      present.delete(args[1]);
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unexpected" };
  };

  const nextExe = "E:\\Moved\\NetcattyPortable.exe";
  const result = applyInitialExplorerContextMenuPreference({
    app: { getPath: () => "C:\\Users\\test\\AppData\\Roaming\\Netcatty" },
    executablePath: nextExe,
    platform: "win32",
    fsModule,
    spawnSyncImpl,
    logWarn: () => {},
  });
  assert.equal(result.success, true);
  assert.equal(result.enabled, true);
  assert.equal(wrote?.executablePath, nextExe);
  assert.ok(
    [...values.values()].some((value) => String(value).includes(nextExe)),
    "registry command should use the new portable launcher path",
  );
});
