/**
 * Split opaque sync secrets out of plugin configuration so only non-secret
 * JSON reaches cloud persistence / SyncConnectPayload.configuration.
 */

export const PLUGIN_SYNC_SECRET_CONFIG_KEYS = [
  'password',
  'token',
  'secret',
  'apiKey',
  'accessToken',
] as const;

export type PluginSyncSecretConfigKey = (typeof PLUGIN_SYNC_SECRET_CONFIG_KEYS)[number];

export interface PluginSyncExtractedSecret {
  /** Configuration property name that held the secret. */
  key: string;
  value: string;
  /** SecretStore key used for the opaque ref (stable per config field). */
  secretKey: string;
}

export interface PluginSyncCredentialPlan {
  /** Configuration with secret fields removed (safe to persist as plugin config). */
  configuration: unknown;
  /** All extracted top-level secrets (may be empty). */
  secrets: PluginSyncExtractedSecret[];
  /**
   * Primary secret for SyncConnectPayload.credential (first extracted).
   * Additional secrets remain in OS storage under their secretKey for plugins
   * that call secrets.get / createLease by key.
   */
  plaintextSecret?: string;
  secretKey: string;
  extractedFrom?: string;
}

function isWellKnownSecretConfigKey(key: string): boolean {
  return (PLUGIN_SYNC_SECRET_CONFIG_KEYS as readonly string[]).includes(key);
}

/**
 * Top-level property names that configurationSchema marks as writeOnly string
 * fields (JSON Schema writeOnly) — treated as secrets even when not well-known names.
 */
export function listWriteOnlySecretPropertyNames(schema: unknown): string[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];
  const properties = (schema as { properties?: unknown }).properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];
  const names: string[] = [];
  for (const [name, child] of Object.entries(properties as Record<string, unknown>)) {
    if (!child || typeof child !== 'object' || Array.isArray(child)) continue;
    const node = child as { type?: unknown; writeOnly?: unknown };
    if (node.writeOnly === true && (node.type === undefined || node.type === 'string')) {
      names.push(name);
    }
  }
  return names;
}

function secretStoreKeyForConfigField(field: string): string {
  return field === 'password' ? 'sync-credential' : `sync-credential:${field}`;
}

/**
 * Extract top-level secret strings from plugin configuration JSON.
 * Every matching key is removed from configuration and returned in `secrets`.
 * Non-object configs pass through unchanged.
 *
 * Secret keys are the well-known name whitelist plus any top-level properties
 * marked `writeOnly: true` in the provider configurationSchema.
 */
export function planPluginSyncCredential(
  configuration: unknown,
  options?: { configurationSchema?: unknown },
): PluginSyncCredentialPlan {
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) {
    return { configuration, secrets: [], secretKey: 'sync-credential' };
  }
  const source = configuration as Record<string, unknown>;
  const schemaSecretNames = new Set(listWriteOnlySecretPropertyNames(options?.configurationSchema));
  const candidateKeys = new Set<string>([
    ...PLUGIN_SYNC_SECRET_CONFIG_KEYS,
    ...schemaSecretNames,
  ]);
  const secrets: PluginSyncExtractedSecret[] = [];
  // Stable order: well-known list first, then schema writeOnly names alphabetically.
  const orderedKeys = [
    ...PLUGIN_SYNC_SECRET_CONFIG_KEYS.filter((key) => candidateKeys.has(key)),
    ...[...schemaSecretNames].filter((key) => !isWellKnownSecretConfigKey(key)).sort(),
  ];
  for (const key of orderedKeys) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) {
      secrets.push({
        key,
        value,
        secretKey: secretStoreKeyForConfigField(key),
      });
    }
  }
  if (secrets.length === 0) {
    return { configuration, secrets: [], secretKey: 'sync-credential' };
  }
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (candidateKeys.has(key)) continue;
    stripped[key] = value;
  }
  const primary = secrets[0]!;
  return {
    configuration: stripped,
    secrets,
    plaintextSecret: primary.value,
    secretKey: primary.secretKey,
    extractedFrom: primary.key,
  };
}

/**
 * Sync connect strips secret fields from configuration before invoke. Host
 * schema validation must therefore treat those keys as optional even when the
 * contribution marks them required (secrets arrive via SyncConnectPayload.credential).
 */
export function syncConfigurationSchemaWithoutSecretRequirements(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const source = schema as Record<string, unknown>;
  if (!Array.isArray(source.required)) return schema;
  const secretNames = new Set([
    ...PLUGIN_SYNC_SECRET_CONFIG_KEYS,
    ...listWriteOnlySecretPropertyNames(schema),
  ]);
  const required = source.required.filter(
    (name) => typeof name === 'string' && !secretNames.has(name),
  );
  if (required.length === source.required.length) return schema;
  return { ...source, required };
}

/** Stable SecretStore keys used for plugin sync credentials (for delete-on-disconnect). */
export function pluginSyncSecretStoreKeys(extraFieldNames: readonly string[] = []): readonly string[] {
  const keys = new Set<string>([
    'sync-credential',
    ...PLUGIN_SYNC_SECRET_CONFIG_KEYS
      .filter((key) => key !== 'password')
      .map((key) => `sync-credential:${key}`),
  ]);
  for (const name of extraFieldNames) {
    if (typeof name === 'string' && name.length > 0) {
      keys.add(secretStoreKeyForConfigField(name));
    }
  }
  return [...keys];
}
