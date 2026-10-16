/* eslint-disable no-undef */

"use strict";

/**
 * systemd service management over SSH exec.
 * List/status via systemctl; mutate with optional sudo (same session password
 * pattern as dockerOps).
 */

function shQuote(str) {
  return `'${String(str).replace(/'/g, `'\"'\"'`)}'`;
}

function sanitizeUnitName(name) {
  const trimmed = String(name || "").trim().slice(0, 256);
  // systemd unit names: letters, digits, : . _ @ - and must end with a type suffix ideally
  if (!trimmed || !/^[A-Za-z0-9:._@\\-]+$/.test(trimmed)) return null;
  return trimmed;
}

const ALLOWED_ACTIONS = new Set(["start", "stop", "restart", "enable", "disable", "reload"]);

function normalizeActiveState(raw) {
  const text = String(raw || "").trim().toLowerCase();
  if (
    text === "active"
    || text === "inactive"
    || text === "failed"
    || text === "activating"
    || text === "deactivating"
    || text === "reloading"
  ) {
    return text;
  }
  return "unknown";
}

function normalizeLoadState(raw) {
  const text = String(raw || "").trim().toLowerCase();
  if (
    text === "loaded"
    || text === "not-found"
    || text === "bad-setting"
    || text === "error"
    || text === "masked"
  ) {
    return text;
  }
  return "unknown";
}

function parseSystemctlListUnits(stdout, scope) {
  const units = [];
  for (const line of String(stdout || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cleaned = trimmed.replace(/^●\s*/, "");
    if (!cleaned || /^UNIT\b/i.test(cleaned) || /^Legend:/i.test(cleaned)) continue;
    if (/^\d+ loaded units listed/i.test(cleaned)) continue;
    if (/^To show all/i.test(cleaned)) continue;
    // UNIT LOAD ACTIVE SUB [DESCRIPTION] — description may be empty
    const m = cleaned.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/);
    if (!m) continue;
    const name = m[1];
    if (!name.includes(".")) continue;
    units.push({
      name,
      loadState: normalizeLoadState(m[2]),
      activeState: normalizeActiveState(m[3]),
      subState: m[4],
      description: (m[5] || "").trim(),
      scope,
    });
  }
  return units;
}

function getSessionSudoPassword(session) {
  return typeof session?.systemManagerSudoPassword === "string" && session.systemManagerSudoPassword.length > 0
    ? session.systemManagerSudoPassword
    : null;
}

function isSuccessfulCommandResult(result) {
  return result?.success && (result.code === 0 || result.code === null || result.code === undefined);
}

function commandError(result, fallback) {
  return (result?.stderr || result?.error || "").trim() || fallback;
}

function isPermissionDenied(result) {
  const text = `${result?.stderr || ""}\n${result?.stdout || ""}\n${result?.error || ""}`.toLowerCase();
  return text.includes("permission denied")
    || text.includes("access denied")
    || text.includes("authentication is required")
    || text.includes("interactive authentication required")
    || text.includes("not authorized");
}

const LIST_UNITS_INNER = [
  'printf "%s\\n" "__NC_SERVICES_BEGIN__"; ',
  'if command -v systemctl >/dev/null 2>&1; then ',
  'printf "%s\\n" "__NC_SYSTEM__"; ',
  // --plain needs systemd >= ~230; fall back for RHEL/CentOS 7-era hosts.
  "systemctl list-units --type=service --all --no-pager --no-legend --plain 2>/dev/null ",
  "|| systemctl list-units --type=service --all --no-pager --no-legend 2>/dev/null ",
  "|| true; ",
  'printf "%s\\n" "__NC_USER__"; ',
  "systemctl --user list-units --type=service --all --no-pager --no-legend --plain 2>/dev/null ",
  "|| systemctl --user list-units --type=service --all --no-pager --no-legend 2>/dev/null ",
  "|| true; ",
  "fi; ",
  'printf "%s\\n" "__NC_SERVICES_END__"',
].join("");

const LIST_UNITS_SCRIPT = `exec sh -c ${JSON.stringify(LIST_UNITS_INNER)}`;

function extractBetween(stdout, startMarker, endMarkers) {
  const text = String(stdout || "");
  const begin = text.indexOf(startMarker);
  if (begin < 0) return "";
  const after = text.slice(begin + startMarker.length);
  let end = -1;
  for (const marker of endMarkers) {
    const idx = after.indexOf(marker);
    if (idx >= 0 && (end < 0 || idx < end)) end = idx;
  }
  return end >= 0 ? after.slice(0, end) : after;
}

function parseServiceList(stdout) {
  const text = String(stdout || "");
  const systemPart = extractBetween(text, "__NC_SYSTEM__", ["__NC_USER__", "__NC_SERVICES_END__"]);
  const userPart = extractBetween(text, "__NC_USER__", ["__NC_SERVICES_END__"]);
  const systemUnits = parseSystemctlListUnits(systemPart, "system");
  const userUnits = parseSystemctlListUnits(userPart, "user");
  // Prefer system unit when names collide
  const seen = new Set(systemUnits.map((u) => u.name));
  const merged = systemUnits.slice();
  for (const unit of userUnits) {
    if (seen.has(unit.name)) continue;
    seen.add(unit.name);
    merged.push(unit);
  }
  merged.sort((a, b) => {
    if (a.activeState === "failed" && b.activeState !== "failed") return -1;
    if (b.activeState === "failed" && a.activeState !== "failed") return 1;
    return a.name.localeCompare(b.name);
  });
  return merged;
}

function createServiceOpsApi({
  execOnSession,
  getSession,
}) {
  async function listServices(event, sessionId) {
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    const result = await execOnSession(event, sessionId, LIST_UNITS_SCRIPT, 20000, {
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.pending) return { success: false, pending: true };
    if (!result.success) return { success: false, error: result.error || "Failed to list services" };
    return { success: true, units: parseServiceList(result.stdout) };
  }

  async function serviceAction(event, payload) {
    const sessionId = payload?.sessionId;
    const unitName = sanitizeUnitName(payload?.unitName);
    const action = String(payload?.action || "").toLowerCase();
    const scope = payload?.scope === "user" ? "user" : "system";
    if (!sessionId || !unitName) return { success: false, error: "Missing sessionId or unitName" };
    if (!ALLOWED_ACTIONS.has(action)) return { success: false, error: "Invalid action" };

    const userFlag = scope === "user" ? "--user " : "";
    const baseCmd = `systemctl ${userFlag}${action} ${shQuote(unitName)}`;
    const wrapped = `exec sh -c ${JSON.stringify(baseCmd)}`;

    let result = await execOnSession(event, sessionId, wrapped, 30000);
    if (result.pending) return { success: false, pending: true };
    if (isSuccessfulCommandResult(result)) return { success: true };

    // User-scope units should not escalate via sudo.
    if (scope === "user" || !isPermissionDenied(result)) {
      return { success: false, error: commandError(result, `systemctl ${action} failed`) };
    }

    const sudoPassword = getSessionSudoPassword(getSession?.(sessionId));
    const passwordless = `exec sh -c ${JSON.stringify(`sudo systemctl ${action} ${shQuote(unitName)}`)}`;
    const passwordlessResult = await execOnSession(event, sessionId, passwordless, 30000);
    if (passwordlessResult.pending) return { success: false, pending: true };
    if (isSuccessfulCommandResult(passwordlessResult)) return { success: true };

    if (sudoPassword) {
      const withPassword = `exec sh -c ${JSON.stringify(`sudo -S -p '' systemctl ${action} ${shQuote(unitName)}`)}`;
      const sudoResult = await execOnSession(event, sessionId, withPassword, 30000, {
        stdin: `${sudoPassword}\n`,
      });
      if (sudoResult.pending) return { success: false, pending: true };
      if (isSuccessfulCommandResult(sudoResult)) return { success: true };
      return { success: false, error: commandError(sudoResult, `sudo systemctl ${action} failed`) };
    }

    return {
      success: false,
      error: commandError(
        passwordlessResult.success === false ? passwordlessResult : result,
        `systemctl ${action} failed (sudo required)`,
      ),
    };
  }

  return {
    listServices,
    serviceAction,
    parseServiceList,
    parseSystemctlListUnits,
    sanitizeUnitName,
  };
}

module.exports = {
  createServiceOpsApi,
  parseServiceList,
  parseSystemctlListUnits,
  sanitizeUnitName,
  LIST_UNITS_SCRIPT,
};
