/* eslint-disable no-undef */

"use strict";

/**
 * Listening-port collectors.
 * Parsing approach inspired by Portwatch (ss -tlnp + process field), adapted for
 * remote SSH exec, UDP, IPv6, macOS netstat/lsof, and BusyBox netstat.
 */

const LISTEN_PORTS_INNER = [
  'printf "%s\\n" "__NC_PORTS_BEGIN__"; ',
  // Run every available collector. macOS often has netstat without useful PID
  // columns; lsof fills that gap. Prefer merging over elif exclusivity.
  'if command -v ss >/dev/null 2>&1; then ',
  'printf "%s\\n" "__NC_SS__"; ',
  "ss -H -tulnp 2>/dev/null || ss -tulnp 2>/dev/null || true; ",
  "fi; ",
  'if command -v netstat >/dev/null 2>&1; then ',
  'printf "%s\\n" "__NC_NETSTAT__"; ',
  // `-lntp` is TCP-only; prefer `-lntup`, else TCP+UDP separately. macOS uses `-anv -p`.
  "if netstat -lntup 2>/dev/null; then :; ",
  "elif netstat -lntp 2>/dev/null; then ",
  "netstat -lnup 2>/dev/null || true; ",
  "elif netstat -anv -p tcp >/dev/null 2>&1; then ",
  // Prefer LISTEN-only TCP to keep stdout under maxBuffer on busy hosts.
  "netstat -anv -p tcp 2>/dev/null | grep -i LISTEN || true; ",
  "netstat -anv -p udp 2>/dev/null || true; ",
  "else ",
  "netstat -anp 2>/dev/null | grep -Ei 'LISTEN|^udp' || netstat -an 2>/dev/null | grep -Ei 'LISTEN|^udp' || true; ",
  "fi; ",
  "fi; ",
  'if command -v lsof >/dev/null 2>&1; then ',
  'printf "%s\\n" "__NC_LSOF__"; ',
  "lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null || true; ",
  // Idle-only: Linux has no UDP state names, so this no-ops there (ss/netstat cover UDP).
  // Do not fall back to bare `-iUDP` — that dumps client binds as fake listeners.
  "lsof -nP -iUDP -sUDP:Idle 2>/dev/null || true; ",
  "fi; ",
  'printf "%s\\n" "__NC_PORTS_END__"',
].join("");

const LISTEN_PORTS_SCRIPT = `exec sh -c ${JSON.stringify(LISTEN_PORTS_INNER)}`;

const LISTEN_PORTS_WINDOWS = [
  'Write-Output "__NC_PORTS_BEGIN__"; ',
  'Write-Output "__NC_WIN__"; ',
  "$rows = @(); ",
  "$rows += @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ",
  "Select-Object LocalAddress,LocalPort,OwningProcess,@{Name='Protocol';Expression={'tcp'}}); ",
  // UDP has no listen state; drop high ephemeral ports on non-wildcard/non-loopback
  // addresses so client binds do not flood the Ports tab.
  "$rows += @(Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { ",
  "$a = [string]$_.LocalAddress; ",
  "$wildcard = ($a -eq '0.0.0.0' -or $a -eq '::' -or $a -eq '*'); ",
  "$loopback = ($a -eq '127.0.0.1' -or $a -eq '::1'); ",
  "if ($wildcard -or $loopback) { $true } else { $_.LocalPort -lt 49152 } ",
  "} | Select-Object LocalAddress,LocalPort,OwningProcess,@{Name='Protocol';Expression={'udp'}}); ",
  "if ($rows.Count -gt 0) { $rows | ConvertTo-Json -Compress } else { Write-Output '[]' }; ",
  'Write-Output "__NC_PORTS_END__"',
].join("");

const LISTEN_PORTS_MAX_BUFFER = 16 * 1024 * 1024;

function normalizeProtocol(raw) {
  const text = String(raw || "").trim().toLowerCase();
  if (text === "tcp" || text === "tcp4") return "tcp";
  // macOS dual-stack (tcp46/udp46) is an IPv6 socket with v6only off; map to
  // tcp6/udp6 so netstat rows merge with lsof IPv6 listeners.
  if (text === "tcp6" || text === "tcp46") return "tcp6";
  if (text === "udp" || text === "udp4") return "udp";
  if (text === "udp6" || text === "udp46") return "udp6";
  return "unknown";
}

function parseListenAddress(addr) {
  const text = String(addr || "").trim();
  if (!text) return null;

  // macOS / BSD netstat: "*.22", "127.0.0.1.53", "::1.631", "fe80::1%lo0.22"
  // Prefer dotted port even when the address contains ':' (IPv6).
  const dotted = text.match(/^(.*)\.(\d+)$/);
  if (dotted) {
    const port = Number(dotted[2]);
    if (Number.isFinite(port) && port >= 0 && port <= 65535) {
      let address = dotted[1] || "*";
      if (address.includes("%")) address = address.split("%")[0];
      if (address === "*" || address === "0.0.0.0" || address === "::") address = "*";
      return { address, port };
    }
  }

  const lastColon = text.lastIndexOf(":");
  if (lastColon <= 0) return null;
  const portText = text.slice(lastColon + 1);
  if (!/^\d+$/.test(portText)) return null;
  const port = Number(portText);
  if (!Number.isFinite(port) || port < 0 || port > 65535) return null;
  let address = text.slice(0, lastColon);
  if (address.startsWith("[") && address.endsWith("]")) {
    address = address.slice(1, -1);
  }
  if (address.includes("%")) address = address.split("%")[0];
  if (address === "*" || address === "0.0.0.0" || address === "::") {
    address = "*";
  }
  return { address, port };
}

function parseSsProcesses(info) {
  const text = String(info || "");
  // users:(("app",pid=11,fd=3),("app",pid=12,fd=4))
  const entries = [];
  const re = /\("([^"]+)",pid=(\d+)/g;
  let match = re.exec(text);
  while (match) {
    entries.push({ processName: match[1] || "", pid: Number(match[2]) });
    match = re.exec(text);
  }
  if (entries.length) return entries;
  return [{ processName: "", pid: null }];
}

function portKey(protocol, address, port, pid) {
  // Include pid so SO_REUSEPORT / multi-process listeners stay distinct.
  return `${normalizeProtocol(protocol)}|${address || "*"}|${port}|${pid == null ? "-" : pid}`;
}

function makePortId(protocol, address, port, pid) {
  return `${normalizeProtocol(protocol)}|${address}|${port}|${pid == null ? "-" : pid}`;
}

function sameSocket(a, protocol, address, port) {
  return a.protocol === protocol && a.address === address && a.port === port;
}

function pushPort(entries, byKey, row) {
  if (!row || !Number.isFinite(row.port)) return;
  const protocol = normalizeProtocol(row.protocol);
  const address = row.address || "*";
  const port = Number(row.port);
  const pid = Number.isFinite(row.pid) && row.pid > 0 ? Number(row.pid) : null;
  const processName = String(row.processName || "");

  if (pid != null) {
    // Drop anonymous placeholder once a PID-bearing collector reports the socket.
    const anonKey = portKey(protocol, address, port, null);
    const anon = byKey.get(anonKey);
    if (anon) {
      byKey.delete(anonKey);
      const idx = entries.indexOf(anon);
      if (idx >= 0) entries.splice(idx, 1);
    }
  } else {
    for (const existing of byKey.values()) {
      if (sameSocket(existing, protocol, address, port) && existing.pid != null) {
        return;
      }
    }
  }

  const key = portKey(protocol, address, port, pid);
  const existing = byKey.get(key);
  if (existing) {
    if (!existing.processName && processName) existing.processName = processName;
    return;
  }
  const entry = {
    id: makePortId(protocol, address, port, pid),
    protocol,
    address,
    port,
    pid,
    processName,
  };
  byKey.set(key, entry);
  entries.push(entry);
}

function isWildcardPeer(peer) {
  const text = String(peer || "").trim();
  return (
    text === "*.*"
    || text === "*:*"
    || text === "0.0.0.0:*"
    || text === ":::*"
    || text === "[::]:*"
    || text === "*."
  );
}

function parseSsOutput(stdout) {
  const entries = [];
  const byKey = new Map();
  for (const line of String(stdout || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^Netid\b/i.test(trimmed) || /^State\b/i.test(trimmed)) continue;
    const parts = trimmed.split(/\s+/);
    // Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port Process
    if (parts.length < 5) continue;
    let protocol;
    let state = "";
    let localAddr;
    let peerAddr = "";
    let processField = "";
    if (/^(tcp|udp)/i.test(parts[0])) {
      protocol = parts[0];
      // With state column: parts[1]=state, parts[4]=local, parts[5]=peer
      if (parts.length >= 6 && (parts[4].includes(":") || parts[4].includes("."))) {
        state = parts[1] || "";
        localAddr = parts[4];
        peerAddr = parts[5] || "";
        processField = parts.slice(6).join(" ");
      } else {
        localAddr = parts[3];
        peerAddr = parts[4] || "";
        processField = parts.slice(5).join(" ");
      }
    } else {
      continue;
    }
    const isUdp = /^udp/i.test(protocol);
    if (!isUdp && state && !/^LISTEN$/i.test(state)) continue;
    if (isUdp && state && !/^(UNCONN|IDLE|LISTEN)$/i.test(state)) continue;
    if (isUdp && peerAddr && !isWildcardPeer(peerAddr)) continue;
    const parsed = parseListenAddress(localAddr);
    if (!parsed) continue;
    for (const proc of parseSsProcesses(processField)) {
      pushPort(entries, byKey, {
        protocol,
        address: parsed.address,
        port: parsed.port,
        pid: proc.pid,
        processName: proc.processName,
      });
    }
  }
  return entries;
}

function parseNetstatOutput(stdout) {
  const entries = [];
  const byKey = new Map();
  for (const line of String(stdout || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^Proto\b/i.test(trimmed) || /^Active\b/i.test(trimmed)) continue;
    // Linux: tcp 0 0 0.0.0.0:22 0.0.0.0:* LISTEN 1234/sshd
    // BusyBox UDP often omits state: udp 0 0 127.0.0.1:53 0.0.0.0:* 456/dnsmasq
    // macOS: tcp4 0 0 *.22 *.* LISTEN
    const m = trimmed.match(
      /^(tcp46|udp46|tcp[46]?|udp[46]?)\s+\d+\s+\d+\s+(\S+)\s+(\S+)(?:\s+(.*))?$/i,
    );
    if (!m) continue;
    const protocol = m[1];
    const local = m[2];
    const peer = m[3];
    const rest = String(m[4] || "").trim();
    const isUdp = /^udp/i.test(protocol);
    let state = "";
    let pidField = "";
    if (rest) {
      const restParts = rest.split(/\s+/);
      if (/^LISTEN$/i.test(restParts[0])) {
        state = "LISTEN";
        pidField = restParts.slice(1).join(" ");
      } else if (isUdp && /^\d+\//.test(restParts[0])) {
        // No State column — remainder is pid/program (may contain spaces).
        pidField = rest;
      } else if (!isUdp) {
        // TCP without LISTEN (ESTABLISHED, or a bare pid token) is not a listener.
        continue;
      }
    }
    if (!isUdp) {
      if (!/^LISTEN$/i.test(state)) continue;
    } else if (!isWildcardPeer(peer)) {
      continue;
    }
    const parsed = parseListenAddress(local);
    if (!parsed) continue;
    let pid = null;
    let processName = "";
    const pidMatch = String(pidField).match(/^(\d+)\/(.+)$/);
    if (pidMatch) {
      pid = Number(pidMatch[1]);
      processName = pidMatch[2];
    }
    pushPort(entries, byKey, {
      protocol,
      address: parsed.address,
      port: parsed.port,
      pid,
      processName,
    });
  }
  return entries;
}

function parseLsofOutput(stdout) {
  const entries = [];
  const byKey = new Map();
  for (const line of String(stdout || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || /^COMMAND\b/i.test(trimmed)) continue;
    // COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
    const parts = trimmed.split(/\s+/);
    if (parts.length < 9) continue;
    const processName = parts[0];
    const pid = Number(parts[1]);
    const typeField = String(parts[4] || "").toUpperCase();
    const nodeField = String(parts[7] || "").toUpperCase();
    const nameField = parts.slice(8).join(" ");
    if (nameField.includes("->")) continue;

    const isUdpNode = nodeField === "UDP" || /\bUDP\b/.test(nameField);
    const isTcpNode = nodeField === "TCP" || /\bTCP\b/.test(nameField) || /\(LISTEN\)/i.test(nameField);
    if (!isUdpNode && !isTcpNode) continue;
    if (isTcpNode && !/\(LISTEN\)/i.test(nameField)) continue;

    // NAME forms: "TCP *:80 (LISTEN)", "TCP [::1]:80 (LISTEN)", "*:22 (LISTEN)"
    const cleaned = nameField
      .replace(/^(?:TCP|UDP)\s+/i, "")
      .replace(/\s+\((LISTEN|UDP)\)\s*$/i, "")
      .trim();
    const parsed = parseListenAddress(cleaned);
    if (!parsed) continue;
    let protocol = isUdpNode ? "udp" : "tcp";
    // typeField is uppercased; match IPV6 / IPv6 before uppercasing would also work.
    if (typeField.includes("IPV6") || parsed.address.includes(":")) {
      protocol = isUdpNode ? "udp6" : "tcp6";
    }
    pushPort(entries, byKey, {
      protocol,
      address: parsed.address,
      port: parsed.port,
      pid: Number.isFinite(pid) ? pid : null,
      processName,
    });
  }
  return entries;
}

function parseWindowsPortsJson(stdout) {
  const entries = [];
  const byKey = new Map();
  const text = String(stdout || "").trim();
  if (!text) return entries;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return entries;
  }
  const list = Array.isArray(raw) ? raw : [raw];
  for (const row of list) {
    if (!row) continue;
    const port = Number(row.LocalPort);
    const pid = Number(row.OwningProcess);
    let address = String(row.LocalAddress || "*");
    const isV6 = address.includes(":");
    if (address === "0.0.0.0" || address === "::" || address === "*") address = "*";
    const protoRaw = String(row.Protocol || "tcp").toLowerCase();
    const isUdp = protoRaw.startsWith("udp");
    pushPort(entries, byKey, {
      protocol: isUdp ? (isV6 ? "udp6" : "udp") : (isV6 ? "tcp6" : "tcp"),
      address,
      port,
      pid: Number.isFinite(pid) && pid > 0 ? pid : null,
      processName: "",
    });
  }
  return entries;
}

function extractSection(stdout, beginMarker) {
  const text = String(stdout || "");
  const begin = text.indexOf(beginMarker);
  if (begin < 0) return "";
  const after = text.slice(begin + beginMarker.length);
  const end = after.search(/\n__NC_(SS|NETSTAT|LSOF|WIN|PORTS_END)__/);
  return end >= 0 ? after.slice(0, end) : after;
}

function sortPorts(entries) {
  return entries.slice().sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol));
}

function parseListeningPorts(stdout) {
  const text = String(stdout || "");
  const entries = [];
  const byKey = new Map();

  const merge = (rows) => {
    for (const row of rows) {
      pushPort(entries, byKey, row);
    }
  };

  if (text.includes("__NC_SS__")) merge(parseSsOutput(extractSection(text, "__NC_SS__")));
  if (text.includes("__NC_NETSTAT__")) merge(parseNetstatOutput(extractSection(text, "__NC_NETSTAT__")));
  if (text.includes("__NC_LSOF__")) merge(parseLsofOutput(extractSection(text, "__NC_LSOF__")));
  if (text.includes("__NC_WIN__")) merge(parseWindowsPortsJson(extractSection(text, "__NC_WIN__")));

  if (entries.length) return sortPorts(entries);

  // Bare output without markers (fallback probes)
  merge(parseSsOutput(text));
  if (entries.length) return sortPorts(entries);
  merge(parseNetstatOutput(text));
  if (entries.length) return sortPorts(entries);
  merge(parseLsofOutput(text));
  return sortPorts(entries);
}

function createPortOpsApi({
  execOnSession,
  execOnLocalMachine,
  isLocalSession,
  process,
}) {
  async function listListeningPorts(event, sessionId) {
    if (!sessionId) return { success: false, error: "Missing sessionId" };

    if (isLocalSession(sessionId) && process.platform === "win32") {
      const result = await execOnLocalMachine(LISTEN_PORTS_WINDOWS, 12000, {
        maxBuffer: LISTEN_PORTS_MAX_BUFFER,
      });
      if (!result.success) return { success: false, error: result.error || "Failed to list ports" };
      return { success: true, ports: parseListeningPorts(result.stdout) };
    }

    const result = await execOnSession(event, sessionId, LISTEN_PORTS_SCRIPT, 12000, {
      maxBuffer: LISTEN_PORTS_MAX_BUFFER,
    });
    if (result.pending) return { success: false, pending: true };
    if (!result.success) return { success: false, error: result.error || "Failed to list ports" };
    return { success: true, ports: parseListeningPorts(result.stdout) };
  }

  return {
    listListeningPorts,
    parseListeningPorts,
    parseSsOutput,
    parseNetstatOutput,
    parseLsofOutput,
  };
}

module.exports = {
  createPortOpsApi,
  parseListeningPorts,
  parseSsOutput,
  parseNetstatOutput,
  parseLsofOutput,
  LISTEN_PORTS_SCRIPT,
};
