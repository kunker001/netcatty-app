const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const OPEN_TERMINAL_PATH_CHANNEL = "netcatty:openTerminalPath";
const OPEN_TERMINAL_PATH_ARG = "--open-terminal-path";

function expandHomePath(targetPath, { osHomedir = os.homedir } = {}) {
  if (!targetPath) return targetPath;
  if (targetPath === "~") return osHomedir();
  if (targetPath.startsWith("~/")) return path.join(osHomedir(), targetPath.slice(2));
  return targetPath;
}

/**
 * Normalize raw CLI / shell path tokens before resolution.
 * Handles leftover quotes, trailing dots from the Windows shell `"%1."` trick,
 * and drive-root trailing separators.
 */
function normalizeOpenTerminalPathToken(rawPath) {
  if (typeof rawPath !== "string") return "";
  let value = rawPath.trim();
  if (!value) return "";

  // Strip one layer of matching quotes that may survive argv parsing.
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
    || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    value = value.slice(1, -1).trim();
  }

  // Windows shell verbs use `"%1."` / `"%V."` so drive roots don't break quoting.
  // Drop a single trailing dot when it is not part of a `..` segment.
  if (process.platform === "win32" || /^[A-Za-z]:[\\/]/.test(value) || value.includes("\\")) {
    if (value.length > 1 && value.endsWith(".") && !value.endsWith("..")) {
      value = value.slice(0, -1);
    }
    // Normalize trailing separators except for drive roots like `C:\`.
    if (/^[A-Za-z]:\\$/.test(value) || /^[A-Za-z]:\/$/.test(value)) {
      return value;
    }
    while (value.length > 1 && (value.endsWith("\\") || value.endsWith("/"))) {
      value = value.slice(0, -1);
    }
  }

  return value;
}

function collectOpenTerminalPathArgs(argv) {
  if (!Array.isArray(argv)) return [];
  const paths = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (typeof arg !== "string") continue;

    if (arg === OPEN_TERMINAL_PATH_ARG) {
      const next = argv[index + 1];
      if (typeof next === "string" && next.trim()) {
        paths.push(normalizeOpenTerminalPathToken(next));
        index += 1;
      }
      continue;
    }

    const prefix = `${OPEN_TERMINAL_PATH_ARG}=`;
    if (arg.startsWith(prefix)) {
      const value = arg.slice(prefix.length);
      if (value.trim()) paths.push(normalizeOpenTerminalPathToken(value));
    }
  }

  return paths.filter(Boolean);
}

function resolveOpenTerminalPath(rawPath, {
  baseDirectory,
  fsModule = fs,
  pathModule = path,
  logWarn = console.warn,
} = {}) {
  const normalized = normalizeOpenTerminalPathToken(rawPath);
  if (!normalized) return null;

  try {
    const expanded = expandHomePath(normalized);
    const resolved = pathModule.isAbsolute(expanded)
      ? pathModule.resolve(expanded)
      : pathModule.resolve(baseDirectory || process.cwd(), expanded);
    const stat = fsModule.statSync(resolved);
    if (stat.isDirectory()) return resolved;
    if (stat.isFile()) return pathModule.dirname(resolved);
    return null;
  } catch (err) {
    logWarn?.("[Main] Ignoring invalid terminal open path:", rawPath, err?.message || err);
    return null;
  }
}

function resolveOpenTerminalPathsFromArgs(argv, options = {}) {
  return collectOpenTerminalPathArgs(argv)
    .map((rawPath) => resolveOpenTerminalPath(rawPath, options))
    .filter(Boolean);
}

module.exports = {
  OPEN_TERMINAL_PATH_ARG,
  OPEN_TERMINAL_PATH_CHANNEL,
  collectOpenTerminalPathArgs,
  expandHomePath,
  normalizeOpenTerminalPathToken,
  resolveOpenTerminalPath,
  resolveOpenTerminalPathsFromArgs,
};
