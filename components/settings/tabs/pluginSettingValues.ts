export function parsePluginStructuredSettingValue(value: unknown): unknown[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) {
    throw new TypeError('Plugin structured setting value must be a JSON array');
  }
  return parsed;
}
