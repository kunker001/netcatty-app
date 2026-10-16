/**
 * App-level HTTP(S) network proxy settings.
 *
 * Distinct from SSH ProxyJump / ProxyCommand profiles in the vault.
 * Used by cloud sync (Google Drive / OneDrive / GitHub / WebDAV / S3),
 * AI provider fetches, and other Chromium/Node outbound HTTPS traffic.
 */

export type HttpNetworkProxyMode = 'system' | 'direct' | 'custom';

export interface HttpNetworkProxySettings {
  mode: HttpNetworkProxyMode;
  /** Custom proxy URL, e.g. http://127.0.0.1:7890 or socks5://127.0.0.1:1080 */
  url: string;
  /** Comma-separated bypass hosts; Chromium also accepts `<local>`. */
  bypass: string;
}

export const DEFAULT_HTTP_NETWORK_PROXY: HttpNetworkProxySettings = {
  mode: 'system',
  url: '',
  bypass: '<local>',
};

const VALID_MODES = new Set<HttpNetworkProxyMode>(['system', 'direct', 'custom']);

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Strip userinfo from proxy URLs without rewriting the rest of the string.
 * Electron `proxyRules` does not support credentials, and we must not persist
 * proxy passwords in localStorage. Avoid `new URL()` round-trips so incomplete
 * drafts like `http://127.0.0.1:` keep the trailing colon while the user types
 * a port.
 */
export function sanitizeProxyUrl(proxyUrl: string): string {
  const trimmed = asTrimmedString(proxyUrl);
  if (!trimmed) return '';
  // Strip userinfo for both scheme URLs (`http://user:pass@host`) and
  // scheme-less drafts (`user:pass@host:8080`). Electron proxyRules does not
  // support credentials and we must not persist proxy passwords.
  return trimmed.replace(/^([a-z][a-z0-9+.-]*:\/\/)?([^/?#]*@)/i, '$1');
}

export function normalizeHttpNetworkProxySettings(
  raw: unknown,
): HttpNetworkProxySettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_HTTP_NETWORK_PROXY };
  }

  const record = raw as Record<string, unknown>;
  const modeRaw = asTrimmedString(record.mode);
  const mode: HttpNetworkProxyMode = VALID_MODES.has(modeRaw as HttpNetworkProxyMode)
    ? (modeRaw as HttpNetworkProxyMode)
    : 'system';
  const url = sanitizeProxyUrl(asTrimmedString(record.url));
  const bypass = asTrimmedString(record.bypass) || DEFAULT_HTTP_NETWORK_PROXY.bypass;

  if (mode === 'system') {
    return { mode: 'system', url: '', bypass: DEFAULT_HTTP_NETWORK_PROXY.bypass };
  }

  if (mode === 'direct') {
    return { mode: 'direct', url: '', bypass: DEFAULT_HTTP_NETWORK_PROXY.bypass };
  }

  // Allow custom mode with an empty URL so the settings UI can show the
  // URL field before the user has typed anything. Electron apply paths
  // treat empty custom as system until a URL is present.
  return { mode: 'custom', url, bypass };
}

export function areHttpNetworkProxySettingsEqual(
  a: HttpNetworkProxySettings,
  b: HttpNetworkProxySettings,
): boolean {
  return a.mode === b.mode && a.url === b.url && a.bypass === b.bypass;
}

/** Payload for Electron `session.setProxy`. */
export function buildElectronProxyConfig(
  settings: HttpNetworkProxySettings,
): { mode: 'system' } | { mode: 'direct' } | {
  mode: 'fixed_servers';
  proxyRules: string;
  proxyBypassRules: string;
} {
  if (settings.mode === 'direct') return { mode: 'direct' };
  if (settings.mode === 'custom') {
    return {
      mode: 'fixed_servers',
      proxyRules: settings.url,
      proxyBypassRules: settings.bypass || DEFAULT_HTTP_NETWORK_PROXY.bypass,
    };
  }
  return { mode: 'system' };
}

export type NodeProxyEnv = {
  HTTP_PROXY: string;
  HTTPS_PROXY: string;
  NO_PROXY: string;
  http_proxy: string;
  https_proxy: string;
  no_proxy: string;
};

/**
 * Env vars for Node `http`/`https`/`webdav`/`aws-sdk` stacks that honor
 * HTTP(S)_PROXY. Returns `null` for system mode so callers leave process.env
 * alone (Chromium `net.fetch` still uses OS proxy via session.setProxy).
 */
export function buildNodeProxyEnv(
  settings: HttpNetworkProxySettings,
): NodeProxyEnv | null {
  if (settings.mode === 'system') return null;

  if (settings.mode === 'direct') {
    return {
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      NO_PROXY: '',
      http_proxy: '',
      https_proxy: '',
      no_proxy: '',
    };
  }

  const url = settings.url;
  const bypass = settings.bypass || '';
  return {
    HTTP_PROXY: url,
    HTTPS_PROXY: url,
    NO_PROXY: bypass,
    http_proxy: url,
    https_proxy: url,
    no_proxy: bypass,
  };
}
