const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const EXPLORER_CONTEXT_MENU_PREFERENCES_FILE = "explorer-context-menu-preferences.json";
// Separate from the user preference: records that a no-verb default-off probe
// completed. Must not be treated as an intentional "disable" choice, because
// ZIP/portable builds can share AppData with a later NSIS install.
const EXPLORER_CONTEXT_MENU_PROBE_FILE = "explorer-context-menu-probe.json";
// Bump when the shell verb command/label/icon contract changes so warm starts
// re-apply registry entries once after upgrade, then stay query-free again.
// v2: prefer PORTABLE_EXECUTABLE_FILE over process.execPath for registry cmds.
// v3: include development app entry path after electron.exe.
const EXPLORER_CONTEXT_MENU_SCHEMA_VERSION = 3;
const SHELL_VERB = "Netcatty";
const DIRECTORY_SHELL_KEY = `Software\\Classes\\Directory\\shell\\${SHELL_VERB}`;
const DIRECTORY_BACKGROUND_SHELL_KEY = `Software\\Classes\\Directory\\Background\\shell\\${SHELL_VERB}`;
const MENU_LABEL = "Open in Netcatty";
const OPEN_TERMINAL_PATH_ARG = "--open-terminal-path";
// Hides a shell verb from Explorer while keeping the key present. Used as a
// per-user override when per-machine (HKLM) keys cannot be deleted without elevation.
const SUPPRESSION_VALUE = "ProgrammaticAccessOnly";

function isWindowsPlatform(platform = process.platform) {
  return platform === "win32";
}

/**
 * Resolve the stable executable path for Explorer shell verbs.
 * electron-builder portable apps unpack under %TEMP%; process.execPath then
 * points at a transient binary that is deleted when the app exits. The
 * durable launcher path is exposed as PORTABLE_EXECUTABLE_FILE.
 */
function resolveExplorerContextMenuExecutablePath({
  execPath = process.execPath,
  env = process.env,
} = {}) {
  return resolveExplorerContextMenuLaunchSpec({ execPath, env }).executablePath;
}

/**
 * Resolve executable + optional app entry args for shell registration.
 * In development (`electron.exe .`), include the absolute app path so Explorer
 * launches Netcatty rather than a bare Electron binary.
 */
function resolveExplorerContextMenuLaunchSpec({
  execPath = process.execPath,
  env = process.env,
  argv = process.argv,
  defaultApp = process.defaultApp,
  pathModule = path,
} = {}) {
  const portable = String(env?.PORTABLE_EXECUTABLE_FILE || "").trim();
  if (portable) {
    return { executablePath: portable, appArgs: [] };
  }
  const exe = String(execPath || "").trim();
  if (defaultApp && typeof argv?.[1] === "string" && argv[1].trim()) {
    const appEntry = pathModule.resolve(argv[1].trim());
    return { executablePath: exe, appArgs: [appEntry] };
  }
  return { executablePath: exe, appArgs: [] };
}

function getExplorerContextMenuPreferencePath({
  app,
  pathModule = path,
} = {}) {
  if (!app || typeof app.getPath !== "function") return null;
  try {
    return pathModule.join(app.getPath("userData"), EXPLORER_CONTEXT_MENU_PREFERENCES_FILE);
  } catch {
    return null;
  }
}

function getExplorerContextMenuProbePath({
  app,
  pathModule = path,
} = {}) {
  if (!app || typeof app.getPath !== "function") return null;
  try {
    return pathModule.join(app.getPath("userData"), EXPLORER_CONTEXT_MENU_PROBE_FILE);
  } catch {
    return null;
  }
}

function readExplorerContextMenuProbeRecord({
  app,
  fsModule = fs,
  pathModule = path,
  logWarn = console.warn,
} = {}) {
  const filePath = getExplorerContextMenuProbePath({ app, pathModule });
  if (!filePath) return null;
  try {
    if (!fsModule.existsSync(filePath)) return null;
    const parsed = JSON.parse(fsModule.readFileSync(filePath, "utf8"));
    const schemaVersion = Number.isInteger(parsed?.schemaVersion)
      ? parsed.schemaVersion
      : 0;
    return { schemaVersion };
  } catch (err) {
    logWarn?.("[Main] Failed to read Explorer context menu probe marker:", err);
    return null;
  }
}

function isExplorerContextMenuProbeCurrent(options = {}) {
  const record = readExplorerContextMenuProbeRecord(options);
  return Boolean(record && record.schemaVersion === EXPLORER_CONTEXT_MENU_SCHEMA_VERSION);
}

function writeExplorerContextMenuProbeMarker({
  app,
  fsModule = fs,
  pathModule = path,
  logWarn = console.warn,
} = {}) {
  const filePath = getExplorerContextMenuProbePath({ app, pathModule });
  if (!filePath) return false;
  try {
    fsModule.mkdirSync(pathModule.dirname(filePath), { recursive: true });
    fsModule.writeFileSync(
      filePath,
      JSON.stringify({ schemaVersion: EXPLORER_CONTEXT_MENU_SCHEMA_VERSION }, null, 2),
    );
    return true;
  } catch (err) {
    logWarn?.("[Main] Failed to write Explorer context menu probe marker:", err);
    return false;
  }
}

function readExplorerContextMenuPreferenceRecord({
  app,
  fsModule = fs,
  pathModule = path,
  logWarn = console.warn,
} = {}) {
  const filePath = getExplorerContextMenuPreferencePath({ app, pathModule });
  if (!filePath) return null;
  try {
    if (!fsModule.existsSync(filePath)) return null;
    const parsed = JSON.parse(fsModule.readFileSync(filePath, "utf8"));
    if (typeof parsed?.enabled !== "boolean") return null;
    const schemaVersion = Number.isInteger(parsed.schemaVersion)
      ? parsed.schemaVersion
      : 0;
    const executablePath = typeof parsed.executablePath === "string"
      ? parsed.executablePath.trim()
      : "";
    const appArgs = Array.isArray(parsed.appArgs)
      ? parsed.appArgs.map((arg) => String(arg || "").trim()).filter(Boolean)
      : [];
    return {
      enabled: parsed.enabled,
      schemaVersion,
      executablePath,
      appArgs,
    };
  } catch (err) {
    logWarn?.("[Main] Failed to read Explorer context menu preference:", err);
    return null;
  }
}

function readExplorerContextMenuEnabledPreference({
  app,
  fsModule = fs,
  pathModule = path,
  logWarn = console.warn,
} = {}) {
  const record = readExplorerContextMenuPreferenceRecord({
    app,
    fsModule,
    pathModule,
    logWarn,
  });
  return record ? record.enabled : null;
}

function normalizeAppArgs(appArgs = []) {
  return Array.isArray(appArgs)
    ? appArgs.map((arg) => String(arg || "").trim()).filter(Boolean)
    : [];
}

function appArgsEqual(left = [], right = []) {
  const a = normalizeAppArgs(left);
  const b = normalizeAppArgs(right);
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function writeExplorerContextMenuEnabledPreference({
  app,
  enabled,
  executablePath = "",
  appArgs = [],
  fsModule = fs,
  pathModule = path,
  logWarn = console.warn,
} = {}) {
  const filePath = getExplorerContextMenuPreferencePath({ app, pathModule });
  if (!filePath) return false;
  try {
    fsModule.mkdirSync(pathModule.dirname(filePath), { recursive: true });
    const payload = {
      enabled: enabled !== false,
      schemaVersion: EXPLORER_CONTEXT_MENU_SCHEMA_VERSION,
    };
    const exe = String(executablePath || "").trim();
    if (exe) payload.executablePath = exe;
    const normalizedArgs = normalizeAppArgs(appArgs);
    if (normalizedArgs.length > 0) payload.appArgs = normalizedArgs;
    fsModule.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    return true;
  } catch (err) {
    logWarn?.("[Main] Failed to write Explorer context menu preference:", err);
    return false;
  }
}

function quoteWindowsCmdArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function buildExplorerContextMenuCommand(executablePath, pathPlaceholder, {
  appArgs = [],
} = {}) {
  const exe = String(executablePath || "").trim();
  const placeholder = String(pathPlaceholder || "").trim();
  if (!exe || !placeholder) return null;
  const prefixArgs = Array.isArray(appArgs)
    ? appArgs.map((arg) => String(arg || "").trim()).filter(Boolean).map(quoteWindowsCmdArg)
    : [];
  const launchPrefix = [quoteWindowsCmdArg(exe), ...prefixArgs].join(" ");
  // Put app args after `--` so Chromium does not consume them, and keep the
  // path in the same token (`=`) so spaces survive CommandLineToArgvW.
  // Trailing `.` avoids the classic `"C:\"` quote-escape bug for drive roots.
  // Development: `"electron.exe" "C:\\...\\app" -- --open-terminal-path="%1."`
  return `${launchPrefix} -- ${OPEN_TERMINAL_PATH_ARG}="${placeholder}."`;
}

function runReg(args, {
  spawnSyncImpl = spawnSync,
  logWarn = console.warn,
} = {}) {
  try {
    const result = spawnSyncImpl("reg.exe", args, {
      encoding: "utf8",
      windowsHide: true,
    });
    return {
      status: typeof result.status === "number" ? result.status : 1,
      stdout: String(result.stdout || ""),
      stderr: String(result.stderr || ""),
      error: result.error || null,
    };
  } catch (err) {
    logWarn?.("[Main] Failed to run reg.exe:", err);
    return {
      status: 1,
      stdout: "",
      stderr: err?.message || String(err),
      error: err,
    };
  }
}

function regKeyExists(hive, keyPath, options = {}) {
  const result = runReg(["query", `${hive}\\${keyPath}`], options);
  return result.status === 0;
}

function regValueExists(hive, keyPath, valueName, options = {}) {
  const result = runReg(["query", `${hive}\\${keyPath}`, "/v", valueName], options);
  return result.status === 0;
}

function parseRegSzValue(stdout) {
  const lines = String(stdout || "").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/\bREG_SZ\s+(.*)$/i);
    if (match) return match[1];
  }
  return null;
}

function readRegStr(hive, keyPath, valueName, options = {}) {
  const args = valueName
    ? ["query", `${hive}\\${keyPath}`, "/v", valueName]
    : ["query", `${hive}\\${keyPath}`, "/ve"];
  const result = runReg(args, options);
  if (result.status !== 0) return null;
  return parseRegSzValue(result.stdout);
}

function deleteRegKey(hive, keyPath, options = {}) {
  if (!regKeyExists(hive, keyPath, options)) return true;
  const result = runReg(["delete", `${hive}\\${keyPath}`, "/f"], options);
  return result.status === 0;
}

function deleteRegValue(hive, keyPath, valueName, options = {}) {
  if (!regValueExists(hive, keyPath, valueName, options)) return true;
  const result = runReg(["delete", `${hive}\\${keyPath}`, "/v", valueName, "/f"], options);
  return result.status === 0;
}

function writeRegStr(hive, keyPath, valueName, value, options = {}) {
  const args = ["add", `${hive}\\${keyPath}`, "/f"];
  if (valueName) {
    args.push("/v", valueName);
  } else {
    args.push("/ve");
  }
  args.push("/t", "REG_SZ", "/d", value);
  const result = runReg(args, options);
  return result.status === 0;
}

function shellVerbIsCurrent(hive, keyPath, {
  executablePath,
  pathPlaceholder,
  iconPath,
  appArgs = [],
}, options = {}) {
  if (!regKeyExists(hive, keyPath, options)) return false;
  // Suppression keys are not a real install even if the path exists.
  if (hive === "HKCU" && isSuppressionKey(hive, keyPath, options)) return false;

  const expectedCommand = buildExplorerContextMenuCommand(executablePath, pathPlaceholder, { appArgs });
  if (!expectedCommand) return false;
  const expectedIcon = `${iconPath || executablePath},0`;

  const currentCommand = readRegStr(hive, `${keyPath}\\command`, "", options);
  if (currentCommand !== expectedCommand) return false;

  const currentLabel = readRegStr(hive, keyPath, "MUIVerb", options);
  if (currentLabel !== MENU_LABEL) return false;

  const currentIcon = readRegStr(hive, keyPath, "Icon", options);
  if (currentIcon !== expectedIcon) return false;

  return true;
}

function writeShellVerb(hive, keyPath, {
  executablePath,
  pathPlaceholder,
  iconPath,
  appArgs = [],
}, options = {}) {
  const command = buildExplorerContextMenuCommand(executablePath, pathPlaceholder, { appArgs });
  if (!command) return false;
  // Skip reg.exe writes when the verb is already current (common warm-start path).
  if (shellVerbIsCurrent(hive, keyPath, {
    executablePath,
    pathPlaceholder,
    iconPath,
    appArgs,
  }, options)) {
    return true;
  }
  const icon = `${iconPath || executablePath},0`;
  return (
    writeRegStr(hive, keyPath, "MUIVerb", MENU_LABEL, options)
    && writeRegStr(hive, keyPath, "Icon", icon, options)
    && writeRegStr(hive, `${keyPath}\\command`, "", command, options)
  );
}

function isSuppressionKey(hive, keyPath, options = {}) {
  return regKeyExists(hive, keyPath, options)
    && regValueExists(hive, keyPath, SUPPRESSION_VALUE, options);
}

function isUserSuppressed(options = {}) {
  // Both verbs must be suppressed; a partial write would otherwise hide only
  // one Explorer entry while still reporting the integration as disabled.
  return (
    isSuppressionKey("HKCU", DIRECTORY_SHELL_KEY, options)
    && isSuppressionKey("HKCU", DIRECTORY_BACKGROUND_SHELL_KEY, options)
  );
}

function writeUserSuppression(options = {}) {
  // HKCU Classes values override HKLM for the same key path. Marking the verb
  // ProgrammaticAccessOnly hides it in Explorer for this user without elevation.
  // Both writes must succeed; roll back a partial pair so disable never leaves
  // only one Explorer entry hidden while the other remains visible.
  //
  // Important: when rolling back, only remove the suppression value (or a key
  // we newly created). Never deleteRegKey a pre-existing portable/user install
  // verb — that would destroy the only working Explorer command if one of the
  // two suppression writes fails.
  const folderExisted = regKeyExists("HKCU", DIRECTORY_SHELL_KEY, options);
  const backgroundExisted = regKeyExists("HKCU", DIRECTORY_BACKGROUND_SHELL_KEY, options);

  const folderOk = writeRegStr("HKCU", DIRECTORY_SHELL_KEY, SUPPRESSION_VALUE, "", options);
  const backgroundOk = writeRegStr(
    "HKCU",
    DIRECTORY_BACKGROUND_SHELL_KEY,
    SUPPRESSION_VALUE,
    "",
    options,
  );
  if (folderOk && backgroundOk) return true;

  if (folderOk) {
    if (folderExisted) {
      deleteRegValue("HKCU", DIRECTORY_SHELL_KEY, SUPPRESSION_VALUE, options);
    } else {
      deleteRegKey("HKCU", DIRECTORY_SHELL_KEY, options);
    }
  }
  if (backgroundOk) {
    if (backgroundExisted) {
      deleteRegValue("HKCU", DIRECTORY_BACKGROUND_SHELL_KEY, SUPPRESSION_VALUE, options);
    } else {
      deleteRegKey("HKCU", DIRECTORY_BACKGROUND_SHELL_KEY, options);
    }
  }
  return false;
}

function clearUserSuppression(options = {}) {
  // Remove per-user ProgrammaticAccessOnly hides without destroying a real
  // portable/user install that was only hidden (command value still present).
  let ok = true;
  for (const keyPath of [DIRECTORY_SHELL_KEY, DIRECTORY_BACKGROUND_SHELL_KEY]) {
    if (!isSuppressionKey("HKCU", keyPath, options)) continue;
    const command = readRegStr("HKCU", `${keyPath}\\command`, "", options);
    if (typeof command === "string" && command.trim()) {
      // Hidden install verb: drop only the suppression value.
      if (!deleteRegValue("HKCU", keyPath, SUPPRESSION_VALUE, options)) ok = false;
    } else if (!deleteRegKey("HKCU", keyPath, options)) {
      // Pure suppression stub with no runnable command.
      ok = false;
    }
  }
  return ok;
}

function clearUserShellKeys(options = {}) {
  // Drop both HKCU Netcatty verbs (real install or suppression). Used when a
  // machine-wide (HKLM) registration exists so stale portable/ZIP HKCU commands
  // cannot take precedence over the all-users path.
  let ok = true;
  for (const keyPath of [DIRECTORY_SHELL_KEY, DIRECTORY_BACKGROUND_SHELL_KEY]) {
    if (!deleteRegKey("HKCU", keyPath, options)) {
      if (regKeyExists("HKCU", keyPath, options)) ok = false;
    }
  }
  return ok;
}

function hasResidualUserShellKeys(options = {}) {
  for (const keyPath of [DIRECTORY_SHELL_KEY, DIRECTORY_BACKGROUND_SHELL_KEY]) {
    if (!regKeyExists("HKCU", keyPath, options)) continue;
    // Any remaining HKCU verb (install or suppression) can hide or override HKLM.
    return true;
  }
  return false;
}

function hasMachineRegistration(options = {}) {
  return (
    regKeyExists("HKLM", DIRECTORY_SHELL_KEY, options)
    || regKeyExists("HKLM", DIRECTORY_BACKGROUND_SHELL_KEY, options)
  );
}

function hasActiveShellKey(hive, keyPath, options = {}) {
  if (!regKeyExists(hive, keyPath, options)) return false;
  // Suppression keys are not an active menu entry.
  if (hive === "HKCU" && isSuppressionKey(hive, keyPath, options)) return false;
  // A bare verb key without a command is a partial write, not a runnable menu.
  const command = readRegStr(hive, `${keyPath}\\command`, "", options);
  return typeof command === "string" && command.trim().length > 0;
}

function isHiveFullyRegistered(hive, options = {}) {
  // Both folder and folder-background verbs are required for a complete install.
  return (
    hasActiveShellKey(hive, DIRECTORY_SHELL_KEY, options)
    && hasActiveShellKey(hive, DIRECTORY_BACKGROUND_SHELL_KEY, options)
  );
}

function isExplorerContextMenuRegistered({
  platform = process.platform,
  spawnSyncImpl = spawnSync,
  logWarn = console.warn,
} = {}) {
  if (!isWindowsPlatform(platform)) return false;
  const options = { spawnSyncImpl, logWarn };
  // Per-user suppression hides machine registration for this user.
  if (isUserSuppressed(options)) return false;
  return isHiveFullyRegistered("HKCU", options) || isHiveFullyRegistered("HKLM", options);
}

function hasAnyActiveShellVerb({
  platform = process.platform,
  spawnSyncImpl = spawnSync,
  logWarn = console.warn,
} = {}) {
  if (!isWindowsPlatform(platform)) return false;
  const options = { spawnSyncImpl, logWarn };
  if (isUserSuppressed(options)) return false;
  for (const hive of ["HKCU", "HKLM"]) {
    if (
      hasActiveShellKey(hive, DIRECTORY_SHELL_KEY, options)
      || hasActiveShellKey(hive, DIRECTORY_BACKGROUND_SHELL_KEY, options)
    ) {
      return true;
    }
  }
  return false;
}

function removeExplorerContextMenu({
  platform = process.platform,
  spawnSyncImpl = spawnSync,
  logWarn = console.warn,
} = {}) {
  if (!isWindowsPlatform(platform)) {
    return { success: true, enabled: false, supported: false };
  }

  const options = { spawnSyncImpl, logWarn };

  // The Settings toggle is a per-user preference (stored under this user's
  // userData). Never delete HKLM verbs here — even when elevated — so other
  // accounts keep the installer-created menu. Machine-wide cleanup belongs to
  // the NSIS uninstaller.
  let success = true;

  if (hasMachineRegistration(options)) {
    // Per-user hide of machine verbs via ProgrammaticAccessOnly. Do not delete
    // working portable/user HKCU install verbs first: if suppression fails
    // (partial write rolled back), Explorer must keep the last working path.
    if (!writeUserSuppression(options)) {
      success = false;
    }
  } else {
    // User-scope only: remove the install keys entirely.
    for (const keyPath of [DIRECTORY_SHELL_KEY, DIRECTORY_BACKGROUND_SHELL_KEY]) {
      if (!deleteRegKey("HKCU", keyPath, options)) {
        if (regKeyExists("HKCU", keyPath, options)) success = false;
      }
    }
  }

  // Any surviving runnable verb counts as still enabled (including a partial
  // single-verb leftover that isExplorerContextMenuRegistered would miss).
  const stillActive = hasAnyActiveShellVerb({ platform, spawnSyncImpl, logWarn });
  return {
    success: success && !stillActive,
    enabled: stillActive,
    supported: true,
  };
}

function installExplorerContextMenu({
  executablePath = process.execPath,
  appArgs = [],
  platform = process.platform,
  spawnSyncImpl = spawnSync,
  logWarn = console.warn,
} = {}) {
  if (!isWindowsPlatform(platform)) {
    return { success: true, enabled: false, supported: false };
  }

  const exe = String(executablePath || "").trim();
  if (!exe) {
    return { success: false, enabled: false, supported: true };
  }

  const options = { spawnSyncImpl, logWarn };
  const normalizedAppArgs = Array.isArray(appArgs)
    ? appArgs.map((arg) => String(arg || "").trim()).filter(Boolean)
    : [];

  // Enable path. For machine installs, refresh HKLM *before* clearing any
  // working HKCU verbs/suppressions: an unelevated process may fail to rewrite
  // HKLM, and deleting portable HKCU first would leave the user with no working
  // Explorer integration.
  const wasSuppressed = isUserSuppressed(options);
  const machineRegistered = hasMachineRegistration(options);
  const folderSpec = {
    executablePath: exe,
    pathPlaceholder: "%1",
    iconPath: exe,
    appArgs: normalizedAppArgs,
  };
  const backgroundSpec = {
    executablePath: exe,
    pathPlaceholder: "%V",
    iconPath: exe,
    appArgs: normalizedAppArgs,
  };

  if (machineRegistered) {
    // Prefer refreshing per-machine verbs. Do NOT mirror into HKCU while the
    // machine registration is fully current: NSIS uninstall only cleans SHCTX
    // (HKLM in all-users mode).
    let writesOk = true;
    for (const [keyPath, spec] of [
      [DIRECTORY_SHELL_KEY, folderSpec],
      [DIRECTORY_BACKGROUND_SHELL_KEY, backgroundSpec],
    ]) {
      if (!writeShellVerb("HKLM", keyPath, spec, options)) writesOk = false;
    }

    const machineCurrent = shellVerbIsCurrent("HKLM", DIRECTORY_SHELL_KEY, folderSpec, options)
      && shellVerbIsCurrent("HKLM", DIRECTORY_BACKGROUND_SHELL_KEY, backgroundSpec, options);

    if (machineCurrent) {
      // HKLM is current — now safe to drop stale portable HKCU verbs and any
      // ProgrammaticAccessOnly hide so Explorer uses the machine path.
      const userKeysCleared = clearUserShellKeys(options) && !hasResidualUserShellKeys(options);
      if (!userKeysCleared) {
        // HKLM is good but residual HKCU still shadows it. Re-hide if the user
        // previously disabled, so we do not leave a half-migrated state.
        if (wasSuppressed) writeUserSuppression(options);
        return {
          success: false,
          enabled: hasAnyActiveShellVerb({ platform, spawnSyncImpl, logWarn }),
          supported: true,
        };
      }

      return {
        success: writesOk || machineCurrent,
        enabled: true,
        supported: true,
      };
    }

    // Residual/stale/partial HKLM keys cannot be repaired without elevation.
    // Fall through to a per-user HKCU registration so ZIP/portable and unelevated
    // Settings toggles still work; HKCU takes precedence over the broken HKLM
    // entries for this user.
  }

  // User-scope install (no usable machine registration): clear suppressions, then write HKCU.
  const userKeysCleared = clearUserSuppression(options);
  let writesOk = true;
  for (const [keyPath, spec] of [
    [DIRECTORY_SHELL_KEY, folderSpec],
    [DIRECTORY_BACKGROUND_SHELL_KEY, backgroundSpec],
  ]) {
    if (!writeShellVerb("HKCU", keyPath, spec, options)) writesOk = false;
  }

  const userCurrent = shellVerbIsCurrent("HKCU", DIRECTORY_SHELL_KEY, folderSpec, options)
    && shellVerbIsCurrent("HKCU", DIRECTORY_BACKGROUND_SHELL_KEY, backgroundSpec, options);
  let success = userKeysCleared && (writesOk || userCurrent);

  if (!success && wasSuppressed) {
    writeUserSuppression(options);
  }

  const enabled = success
    || hasAnyActiveShellVerb({ platform, spawnSyncImpl, logWarn });

  return {
    success,
    enabled,
    supported: true,
  };
}

function applyExplorerContextMenuPreference({
  enabled,
  executablePath = process.execPath,
  appArgs = [],
  platform = process.platform,
  spawnSyncImpl = spawnSync,
  logWarn = console.warn,
} = {}) {
  if (!isWindowsPlatform(platform)) {
    return { success: true, enabled: false, supported: false };
  }
  if (enabled === false) {
    return removeExplorerContextMenu({ platform, spawnSyncImpl, logWarn });
  }
  return installExplorerContextMenu({
    executablePath,
    appArgs,
    platform,
    spawnSyncImpl,
    logWarn,
  });
}

function updateExplorerContextMenuEnabledPreference({
  currentEnabled = true,
  enabled = true,
  applyPreference = () => ({ success: false, enabled: currentEnabled }),
  writePreference = () => false,
} = {}) {
  const nextEnabled = enabled !== false;
  if (nextEnabled === currentEnabled) {
    return { enabled: currentEnabled, success: true, supported: true };
  }

  const applied = applyPreference(nextEnabled) || {};
  if (applied.success !== true) {
    // Apply may have partially mutated the registry (one verb suppressed, or
    // suppression cleared before a failed HKLM refresh). Restore the previous
    // preference so the toggle and Explorer state stay aligned.
    const rolledBack = applyPreference(currentEnabled) || {};
    return {
      enabled: typeof rolledBack.enabled === "boolean" ? rolledBack.enabled : currentEnabled,
      success: false,
      supported: applied.supported !== false,
    };
  }

  const writeSucceeded = writePreference(nextEnabled) === true;
  if (!writeSucceeded) {
    const rolledBack = applyPreference(currentEnabled) || {};
    return {
      enabled: typeof rolledBack.enabled === "boolean" ? rolledBack.enabled : nextEnabled,
      success: false,
      supported: true,
    };
  }

  return {
    enabled: nextEnabled,
    success: true,
    supported: true,
  };
}

function resolveExplorerContextMenuEnabled({
  app,
  platform = process.platform,
  spawnSyncImpl = spawnSync,
  fsModule = fs,
  pathModule = path,
  logWarn = console.warn,
} = {}) {
  if (!isWindowsPlatform(platform)) {
    return { enabled: false, supported: false };
  }

  const preferred = readExplorerContextMenuEnabledPreference({
    app,
    fsModule,
    pathModule,
    logWarn,
  });
  if (typeof preferred === "boolean") {
    return { enabled: preferred, supported: true };
  }

  // Probe-only default-off (no user choice). Still scan for residual verbs so a
  // later per-user (HKCU) or all-users (HKLM) install is not ignored.
  if (isExplorerContextMenuProbeCurrent({ app, fsModule, pathModule, logWarn })) {
    return {
      enabled: hasAnyActiveShellVerb({ platform, spawnSyncImpl, logWarn }),
      supported: true,
    };
  }

  return {
    enabled: isExplorerContextMenuRegistered({ platform, spawnSyncImpl, logWarn })
      || hasAnyActiveShellVerb({ platform, spawnSyncImpl, logWarn }),
    supported: true,
  };
}

function applyInitialExplorerContextMenuPreference({
  app,
  executablePath = process.execPath,
  appArgs = [],
  platform = process.platform,
  spawnSyncImpl = spawnSync,
  fsModule = fs,
  pathModule = path,
  logWarn = console.warn,
} = {}) {
  if (!isWindowsPlatform(platform)) {
    return { enabled: false, success: true, supported: false };
  }

  const record = readExplorerContextMenuPreferenceRecord({
    app,
    fsModule,
    pathModule,
    logWarn,
  });

  const currentExe = String(executablePath || "").trim();
  const normalizedAppArgs = normalizeAppArgs(appArgs);

  // No saved preference: keep installer/portable state, but repair when any
  // residual verb remains (complete or partial). A single leftover verb would
  // otherwise leave the toggle off while Explorer still shows one entry.
  if (record === null) {
    // Probe markers only skip *writes*; always re-check residual verbs. A later
    // per-user NSIS install writes HKCU (not HKLM), so machine-only checks would
    // leave the menu unrepaired under a shared AppData profile.
    const residual = isExplorerContextMenuRegistered({ platform, spawnSyncImpl, logWarn })
      || hasAnyActiveShellVerb({ platform, spawnSyncImpl, logWarn });
    if (residual) {
      const refreshed = installExplorerContextMenu({
        executablePath: currentExe,
        appArgs: normalizedAppArgs,
        platform,
        spawnSyncImpl,
        logWarn,
      });
      if (refreshed.success === true && refreshed.enabled === true) {
        writeExplorerContextMenuEnabledPreference({
          app,
          enabled: true,
          executablePath: currentExe,
          appArgs: normalizedAppArgs,
          fsModule,
          pathModule,
          logWarn,
        });
      }
      return {
        // Prefer live residual state when repair fails so a single surviving
        // verb still lights the toggle and can be disabled from Settings.
        enabled: refreshed.enabled === true
          || hasAnyActiveShellVerb({ platform, spawnSyncImpl, logWarn }),
        success: refreshed.success === true,
        supported: true,
      };
    }
    // ZIP / portable default: no verbs and no preference. Record a probe marker
    // only — never write enabled:false as a durable user choice (shared AppData
    // with a later NSIS install would otherwise suppress installer verbs).
    // The marker is informational / for resolve() short-circuit of "no preference
    // yet"; residual verbs are always re-checked above on every launch.
    writeExplorerContextMenuProbeMarker({
      app,
      fsModule,
      pathModule,
      logWarn,
    });
    return { enabled: false, success: true, supported: true };
  }

  const preferred = record.enabled;
  const schemaCurrent = record.schemaVersion === EXPLORER_CONTEXT_MENU_SCHEMA_VERSION;
  // Portable builds / dev checkouts can move; re-apply when the launcher path
  // or development app entry that was last written into the shell verbs no
  // longer matches.
  const executableCurrent = !preferred
    || !currentExe
    || record.executablePath === currentExe;
  const appArgsCurrent = !preferred || appArgsEqual(record.appArgs, normalizedAppArgs);

  // Healthy warm start for enabled installs: schema + launch identity match
  // *and* both Explorer verbs still look registered. An interrupted installer
  // rewrite or partial cleanup can leave a current preference while one verb
  // is missing; re-apply in that case instead of short-circuiting forever.
  // Disabled preference is never short-circuited: NSIS updates re-create shell
  // verbs unconditionally, so we must re-assert per-user suppression each launch.
  if (preferred === true && schemaCurrent && executableCurrent && appArgsCurrent) {
    if (isExplorerContextMenuRegistered({ platform, spawnSyncImpl, logWarn })) {
      return { enabled: true, success: true, supported: true };
    }
  }

  // Schema bump, portable path change, dev app path change, or disabled preference: re-apply.
  const applied = applyExplorerContextMenuPreference({
    enabled: preferred,
    executablePath: currentExe,
    appArgs: normalizedAppArgs,
    platform,
    spawnSyncImpl,
    logWarn,
  });
  if (applied.success === true) {
    writeExplorerContextMenuEnabledPreference({
      app,
      // Keep the user's intended preference as source of truth.
      enabled: preferred,
      executablePath: currentExe,
      appArgs: normalizedAppArgs,
      fsModule,
      pathModule,
      logWarn,
    });
  }
  return {
    // UI follows the saved preference when apply succeeds; on failure fall back
    // to the live registry so the toggle stays honest about residual menus.
    enabled: applied.success === true
      ? preferred === true
      : applied.enabled === true,
    success: applied.success === true,
    supported: true,
  };
}

module.exports = {
  DIRECTORY_BACKGROUND_SHELL_KEY,
  DIRECTORY_SHELL_KEY,
  EXPLORER_CONTEXT_MENU_PREFERENCES_FILE,
  EXPLORER_CONTEXT_MENU_PROBE_FILE,
  EXPLORER_CONTEXT_MENU_SCHEMA_VERSION,
  MENU_LABEL,
  SUPPRESSION_VALUE,
  applyExplorerContextMenuPreference,
  applyInitialExplorerContextMenuPreference,
  buildExplorerContextMenuCommand,
  getExplorerContextMenuPreferencePath,
  installExplorerContextMenu,
  isExplorerContextMenuRegistered,
  isWindowsPlatform,
  readExplorerContextMenuEnabledPreference,
  removeExplorerContextMenu,
  resolveExplorerContextMenuEnabled,
  resolveExplorerContextMenuExecutablePath,
  resolveExplorerContextMenuLaunchSpec,
  updateExplorerContextMenuEnabledPreference,
  writeExplorerContextMenuEnabledPreference,
};
