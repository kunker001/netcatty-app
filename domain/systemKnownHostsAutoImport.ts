/**
 * Preference for silently importing OpenSSH system known_hosts into the vault.
 * Default remains enabled for backward compatibility; users can turn it off so
 * Vault known-hosts pages no longer re-import unrelated system entries.
 */
export const DEFAULT_AUTO_IMPORT_SYSTEM_KNOWN_HOSTS = true;

export function resolveAutoImportSystemKnownHosts(
  stored: boolean | null | undefined,
): boolean {
  return stored ?? DEFAULT_AUTO_IMPORT_SYSTEM_KNOWN_HOSTS;
}

export function shouldAutoScanSystemKnownHosts(options: {
  autoImportEnabled: boolean;
  alreadyScanned: boolean;
}): boolean {
  return options.autoImportEnabled && !options.alreadyScanned;
}
