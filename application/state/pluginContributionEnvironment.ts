export const PLUGIN_THEME_TOKEN_NAMES = Object.freeze([
  '--background',
  '--foreground',
  '--muted',
  '--muted-foreground',
  '--border',
  '--primary',
  '--primary-foreground',
] as const);

export function selectPluginThemeTokens(
  source: Readonly<Record<string, unknown>> | undefined,
): Record<string, string> {
  if (!source) return {};
  return Object.fromEntries(PLUGIN_THEME_TOKEN_NAMES.flatMap((name) => {
    const value = source[name];
    return typeof value === 'string' && value.length > 0 ? [[name, value]] : [];
  }));
}
