/**
 * Cloud provider identity helpers.
 *
 * Built-in providers keep their stable short IDs. Plugin sync Providers use
 * namespaced contribution IDs (e.g. com.example.backup.sync). The manager
 * boundary accepts both without coercing missing plugins away.
 */

export const BUILTIN_CLOUD_PROVIDERS = [
  'github',
  'google',
  'onedrive',
  'webdav',
  's3',
] as const;

export type BuiltinCloudProvider = (typeof BUILTIN_CLOUD_PROVIDERS)[number];

/** Built-in short IDs or namespaced plugin contribution IDs. */
export type CloudProviderId = BuiltinCloudProvider | (string & {});

const BUILTIN_SET = new Set<string>(BUILTIN_CLOUD_PROVIDERS);

export function isBuiltinCloudProvider(provider: string): provider is BuiltinCloudProvider {
  return BUILTIN_SET.has(provider);
}

/**
 * True when the provider ID looks like a namespaced plugin contribution.
 * Contribution IDs are reverse-DNS style and always contain a dot.
 */
export function isPluginCloudProviderId(provider: string): boolean {
  if (isBuiltinCloudProvider(provider)) return false;
  if (typeof provider !== 'string' || provider.length < 3 || provider.length > 256) return false;
  if (provider.includes('\0') || provider.includes('/') || provider.includes('\\')) return false;
  return provider.includes('.');
}

export function assertCloudProviderId(provider: string): CloudProviderId {
  if (typeof provider !== 'string' || provider.length < 1 || provider.length > 256) {
    throw new TypeError('Cloud provider ID is invalid');
  }
  if (provider.includes('\0')) {
    throw new TypeError('Cloud provider ID is invalid');
  }
  return provider;
}

/** localStorage / encrypted local key for a provider connection record. */
export function providerConnectionStorageKey(provider: CloudProviderId): string {
  if (isBuiltinCloudProvider(provider)) {
    return `netcatty_provider_${provider}_v1`;
  }
  // Plugin IDs may contain characters unsafe for ad-hoc key templates.
  return `netcatty_provider_plugin_v1:${provider}`;
}

/** Registry of dynamic plugin provider IDs that have been connected on this device. */
export const PLUGIN_CLOUD_PROVIDER_REGISTRY_KEY = 'netcatty_plugin_cloud_providers_v1';
