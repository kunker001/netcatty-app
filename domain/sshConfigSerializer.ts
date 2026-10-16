import { Host } from "./models";
import { hasMacKeychainAgentDirectives } from "./sshAuth";

const DEFAULT_SSH_PORT = 22;
const MANAGED_BLOCK_BEGIN = "# BEGIN NETCATTY MANAGED - DO NOT EDIT THIS BLOCK";
const MANAGED_BLOCK_END = "# END NETCATTY MANAGED";
const UNSAFE_SSH_CONFIG_VALUE = /[\r\n\0]/;
const UNSAFE_SSH_PROXY_JUMP_HOSTNAME = /[\s,@#]/;
const UNSAFE_SSH_PROXY_JUMP_USERNAME = /[\s,#]/;
const UNSAFE_SSH_HOST_ALIAS = /["\\*?!,[\]@#]/;
const UNSAFE_SSH_HOST_MATCH_LITERAL = /[\s*?!,[\]@#]/;
const ENCODED_HOST_ALIAS_PREFIX = "netcatty-encoded-";

const assertSafeSshConfigValue = (value: string, field: string): void => {
  if (UNSAFE_SSH_CONFIG_VALUE.test(value)) {
    throw new Error(`${field} must not contain line breaks or null bytes.`);
  }
};

export const toSafeSshHostAlias = (label: string, hostname: string): string => {
  assertSafeSshConfigValue(label, "Host label");
  assertSafeSshConfigValue(hostname, "Host hostname");
  const alias = label.replace(/\s/g, '') || hostname.replace(/\s/g, '');
  if (!alias) throw new Error("Host alias must not be empty.");
  const needsEncoding = alias.startsWith('-')
    || alias.startsWith(ENCODED_HOST_ALIAS_PREFIX)
    || UNSAFE_SSH_HOST_ALIAS.test(alias);
  if (!needsEncoding) return alias;
  const encoded = Array.from(new TextEncoder().encode(alias), (byte) =>
    byte.toString(16).padStart(2, '0')).join('');
  return `${ENCODED_HOST_ALIAS_PREFIX}${encoded}`;
};

export const isSafeSshHostMatchLiteral = (value: string): boolean =>
  !UNSAFE_SSH_CONFIG_VALUE.test(value) && !UNSAFE_SSH_HOST_MATCH_LITERAL.test(value);

const assertSafeProxyJumpHostname = (value: string): void => {
  assertSafeSshConfigValue(value, "Jump host hostname");
  if (value.startsWith('-') || UNSAFE_SSH_PROXY_JUMP_HOSTNAME.test(value)) {
    throw new Error("Jump host hostname contains SSH ProxyJump separator characters.");
  }
};

const assertSafeProxyJumpUsername = (value: string): void => {
  const field = "Jump host username";
  assertSafeSshConfigValue(value, field);
  if (value.startsWith('-') || UNSAFE_SSH_PROXY_JUMP_USERNAME.test(value)) {
    throw new Error(`${field} contains SSH ProxyJump separator characters.`);
  }
};

const formatSshConfigArgument = (value: string): string => {
  if (!/[\s"\\#]/.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
};

/**
 * Check if a string is an IPv6 address
 */
const isIPv6 = (hostname: string): boolean => {
  // IPv6 addresses contain colons and may be wrapped in brackets
  return hostname.includes(':') && !hostname.startsWith('[');
};

/**
 * Serialize a single jump host to ProxyJump format
 * Format: [user@]host[:port]
 * @param host - The jump host to serialize
 * @param managedHostIds - Set of host IDs that have Host blocks in the managed config
 */
const serializeJumpHost = (host: Host, managedHostIds: Set<string>): string => {
  assertSafeSshConfigValue(host.label, "Jump host label");
  assertSafeSshConfigValue(host.hostname, "Jump host hostname");
  if (host.username) {
    assertSafeProxyJumpUsername(host.username);
  }
  let result = "";
  if (host.username) {
    result += `${host.username}@`;
  }

  // Only use label as alias if this jump host is in the managed hosts (has a Host block)
  // and sanitize it by removing spaces. Otherwise use hostname directly.
  let hostPart: string;
  if (managedHostIds.has(host.id) && host.label) {
    // Use the same literal-safe alias as the Host block.
    hostPart = toSafeSshHostAlias(host.label, host.hostname);
  } else {
    // Jump host is outside managed config, use hostname directly
    hostPart = host.hostname;
    assertSafeProxyJumpHostname(hostPart);
  }

  // For IPv6 addresses, always wrap in brackets to disambiguate colons
  // OpenSSH requires brackets for IPv6 in ProxyJump regardless of port
  if (isIPv6(hostPart)) {
    result += `[${hostPart}]`;
    if (host.port && host.port !== DEFAULT_SSH_PORT) {
      result += `:${host.port}`;
    }
  } else {
    result += hostPart;
    if (host.port && host.port !== DEFAULT_SSH_PORT) {
      result += `:${host.port}`;
    }
  }

  return result;
};

/**
 * Build ProxyJump directive from hostChain
 * @param host - The host with hostChain
 * @param allHosts - All hosts to look up jump host details
 * @param managedHostIds - Set of host IDs that have Host blocks in the managed config
 * @returns ProxyJump value string or null if chain is empty/invalid
 */
const buildProxyJumpValue = (
  host: Host,
  allHosts: Host[],
  managedHostIds: Set<string>,
): string | null => {
  if (!host.hostChain?.hostIds || host.hostChain.hostIds.length === 0) {
    return null;
  }

  const hostMap = new Map(allHosts.map(h => [h.id, h]));
  const jumpParts: string[] = [];

  for (const jumpHostId of host.hostChain.hostIds) {
    const jumpHost = hostMap.get(jumpHostId);
    if (jumpHost) {
      jumpParts.push(serializeJumpHost(jumpHost, managedHostIds));
    }
  }

  return jumpParts.length > 0 ? jumpParts.join(",") : null;
};

export const serializeHostsToSshConfig = (hosts: Host[], allHosts?: Host[]): string => {
  const blocks: string[] = [];
  // Use provided allHosts for jump host lookup, or fall back to hosts array
  const hostsForLookup = allHosts || hosts;

  // Build set of managed host IDs (SSH hosts that will have Host blocks)
  const managedHostIds = new Set(
    hosts
      .filter(h => !h.protocol || h.protocol === "ssh")
      .map(h => h.id)
  );

  for (const host of hosts) {
    if (host.protocol && host.protocol !== "ssh") continue;

    assertSafeSshConfigValue(host.label, "Host label");
    assertSafeSshConfigValue(host.hostname, "Host hostname");
    assertSafeSshConfigValue(host.username, "Host username");

    const lines: string[] = [];
    // Encode SSH pattern characters so UI display names remain usable as literal aliases.
    const alias = toSafeSshHostAlias(host.label, host.hostname);
    lines.push(`Host ${alias}`);

    if (host.hostname !== alias) {
      lines.push(`    HostName ${formatSshConfigArgument(host.hostname)}`);
    }

    if (host.username) {
      lines.push(`    User ${formatSshConfigArgument(host.username)}`);
    }

    if (host.port && host.port !== DEFAULT_SSH_PORT) {
      lines.push(`    Port ${host.port}`);
    }

    if (host.x11Forwarding && !host.moshEnabled) {
      lines.push("    ForwardX11 yes");
    }

    // Serialize IdentityFile paths
    if (host.identityFilePaths && host.identityFilePaths.length > 0) {
      for (const keyPath of host.identityFilePaths) {
        assertSafeSshConfigValue(keyPath, "IdentityFile path");
        lines.push(`    IdentityFile ${formatSshConfigArgument(keyPath)}`);
      }
    }

    const hasMacKeychainAgent = hasMacKeychainAgentDirectives(host);
    let serializedIdentityAgent = host.identityAgent;
    if (host.useSshAgent === false) {
      serializedIdentityAgent = "none";
    } else if (
      host.useSshAgent === true
      && host.identityAgent?.toLowerCase() === "none"
    ) {
      serializedIdentityAgent = "${SSH_AUTH_SOCK}";
    } else if (
      host.useSshAgent === true
      && host.identityAgent === undefined
      && !hasMacKeychainAgent
    ) {
      serializedIdentityAgent = "${SSH_AUTH_SOCK}";
    }

    if (serializedIdentityAgent !== undefined) {
      assertSafeSshConfigValue(serializedIdentityAgent, "IdentityAgent");
      lines.push(`    IdentityAgent ${formatSshConfigArgument(serializedIdentityAgent)}`);
    }

    if (host.identitiesOnly !== undefined) {
      lines.push(`    IdentitiesOnly ${host.identitiesOnly ? "yes" : "no"}`);
    }

    if (host.addKeysToAgent !== undefined) {
      assertSafeSshConfigValue(host.addKeysToAgent, "AddKeysToAgent");
      lines.push(`    AddKeysToAgent ${host.addKeysToAgent}`);
    }

    if (host.useKeychain !== undefined) {
      lines.push(`    UseKeychain ${host.useKeychain ? "yes" : "no"}`);
    }

    // Serialize ProxyJump if host has a chain
    const proxyJumpValue = buildProxyJumpValue(host, hostsForLookup, managedHostIds);
    if (proxyJumpValue) {
      lines.push(`    ProxyJump ${proxyJumpValue}`);
    }

    blocks.push(lines.join("\n"));
  }

  return blocks.join("\n\n") + "\n";
};

export const mergeWithExistingSshConfig = (
  existingContent: string,
  managedHosts: Host[],
  managedHostnameSet: Set<string>,
  allHosts?: Host[],
): string => {
  const lines = existingContent.split(/\r?\n/);
  const preservedBlocks: string[] = [];
  // Track preamble lines (comments/blank lines before first Host/Match block)
  let preambleLines: string[] = [];
  let seenFirstBlock = false;
  let currentBlock: string[] = [];
  let currentHostPatterns: string[] = [];
  let isMatchBlock = false; // Track if current block is a Match block (always preserve)

  const flush = () => {
    if (currentBlock.length > 0) {
      // Match blocks are always preserved (we don't manage them)
      if (isMatchBlock) {
        preservedBlocks.push(currentBlock.join("\n"));
      } else {
        // Filter out managed patterns from the Host line, keep non-managed ones
        const nonManagedPatterns = currentHostPatterns.filter(
          (p) => !managedHostnameSet.has(p.toLowerCase())
        );

        if (nonManagedPatterns.length === currentHostPatterns.length) {
          // No managed patterns - preserve the entire block as-is
          preservedBlocks.push(currentBlock.join("\n"));
        } else if (nonManagedPatterns.length > 0) {
          // Some patterns are managed, some are not - rewrite Host line with only non-managed patterns
          const newHostLine = `Host ${nonManagedPatterns.join(" ")}`;
          const restOfBlock = currentBlock.slice(1); // Everything after Host line
          preservedBlocks.push([newHostLine, ...restOfBlock].join("\n"));
        }
        // If all patterns are managed (nonManagedPatterns.length === 0), drop the entire block
      }

      currentBlock = [];
      currentHostPatterns = [];
      isMatchBlock = false;
    }
  };

  for (const line of lines) {
    const trimmed = line.replace(/#.*/, "").trim();

    const tokens = trimmed.split(/\s+/).filter(Boolean);
    const keyword = tokens[0]?.toLowerCase();

    if (keyword === "host") {
      flush();
      seenFirstBlock = true;
      currentHostPatterns = tokens.slice(1);
      currentBlock.push(line);
    } else if (keyword === "match") {
      flush();
      seenFirstBlock = true;
      isMatchBlock = true;
      currentBlock.push(line);
    } else if (!seenFirstBlock) {
      // Preserve preamble lines (comments, blank lines before first block)
      preambleLines.push(line);
    } else if (currentBlock.length > 0) {
      // Inside a block - add to current block
      currentBlock.push(line);
    } else {
      // Between blocks (comments/blank lines after a block ended)
      // These will be included with the next block or preserved separately
      currentBlock.push(line);
    }
  }
  flush();

  const managedContent = serializeHostsToSshConfig(managedHosts, allHosts);
  const managedBlock = `${MANAGED_BLOCK_BEGIN}\n${managedContent}${MANAGED_BLOCK_END}\n`;
  const preserved = preservedBlocks.join("\n\n");

  // Build final output: preamble + preserved blocks + managed block
  const parts: string[] = [];

  // Add preamble if it has content (trim trailing empty lines but keep structure)
  const preamble = preambleLines.join("\n");
  if (preamble.trim()) {
    parts.push(preamble);
  }

  if (preserved.trim()) {
    parts.push(preserved);
  }

  parts.push(managedBlock);

  return parts.join("\n\n");
};
