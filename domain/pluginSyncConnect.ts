import { pluginConfigurationMatchesSchema } from './pluginConfigurationSchema';

export type PluginSyncConnectPlan =
  | { action: 'connect'; configuration: unknown }
  | { action: 'prompt' };

/**
 * Decide how to connect a plugin sync provider.
 * - Reuse retained config when present (including falsy scalars and JSON null).
 * - Connect with `{}` when no schema or when empty config is schema-valid.
 * - Otherwise prompt for configuration before connect.
 *
 * Callers must set `hasStoredConfig` from property presence (`'config' in`
 * / `hasOwnProperty`), not truthiness — `config: null` is a stored value.
 */
export function planPluginSyncConnect(options: {
  configurationSchema?: unknown;
  storedConfig: unknown;
  hasStoredConfig: boolean;
}): PluginSyncConnectPlan {
  if (options.hasStoredConfig) {
    return { action: 'connect', configuration: options.storedConfig };
  }
  const schema = options.configurationSchema;
  if (schema === undefined) {
    return { action: 'connect', configuration: {} };
  }
  if (pluginConfigurationMatchesSchema(schema, {})) {
    return { action: 'connect', configuration: {} };
  }
  return { action: 'prompt' };
}

/** True when a provider connection retains a config property (including null). */
export function hasPluginProviderStoredConfig(
  connection: { config?: unknown } | null | undefined,
): boolean {
  return connection != null
    && Object.prototype.hasOwnProperty.call(connection, 'config');
}
