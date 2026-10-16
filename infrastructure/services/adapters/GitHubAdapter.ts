/**
 * GitHub OAuth Adapter - Device Flow Implementation
 * 
 * Uses Device Authorization Grant (RFC 8628) which doesn't require a client secret.
 * Perfect for desktop apps where the secret cannot be securely stored.
 * 
 * Flow:
 * 1. Request device code from GitHub
 * 2. User opens browser and enters the code
 * 3. Poll for access token until user completes auth
 * 4. Use Gist API for sync file storage
 */

import {
  SYNC_CONSTANTS,
  type OAuthTokens,
  type ProviderAccount,
  type SyncedFile,
  type GitHubDeviceCodeResponse,
} from '../../../domain/sync';
import { netcattyBridge } from '../netcattyBridge';

// ============================================================================
// Types
// ============================================================================

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

export interface GitHubGistFile {
  filename: string;
  /** Embedded body from the Gist API. Truncated at ~1 MB when `truncated` is true. */
  content?: string;
  truncated?: boolean;
  raw_url?: string;
  /** File size in UTF-8 bytes (GitHub Gist API). */
  size?: number;
}

export interface GitHubGist {
  id: string;
  description: string;
  files: Record<string, GitHubGistFile>;
  created_at: string;
  updated_at: string;
  history?: Array<{
    version: string;
    committed_at: string;
  }>;
}

export interface DeviceFlowState {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
  authAttemptId?: number;
}

const createGitHubPollId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `github-poll-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const createGitHubCancelError = (): Error => {
  const error = new Error('GitHub auth cancelled');
  error.name = 'AbortError';
  return error;
};

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw createGitHubCancelError();
  }
};

const delayWithSignal = (ms: number, signal?: AbortSignal): Promise<void> => {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(createGitHubCancelError());
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(createGitHubCancelError());
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
};

// ============================================================================
// Device Flow Authentication
// ============================================================================

/**
 * Start GitHub Device Flow authentication
 * Returns codes for user to enter in browser
 */
export const startDeviceFlow = async (): Promise<DeviceFlowState> => {
  console.log('[GitHub] Starting device flow...');
  console.log('[GitHub] Client ID:', SYNC_CONSTANTS.GITHUB_CLIENT_ID);

  const bridge = netcattyBridge.get();
  if (bridge?.githubStartDeviceFlow) {
    return bridge.githubStartDeviceFlow({
      clientId: SYNC_CONSTANTS.GITHUB_CLIENT_ID,
      scope: 'gist read:user',
    });
  }
  
  let response: Response;
  try {
    response = await fetch(SYNC_CONSTANTS.GITHUB_DEVICE_CODE_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: SYNC_CONSTANTS.GITHUB_CLIENT_ID,
        scope: 'gist read:user',
      }).toString(),
    });
  } catch (fetchError) {
    console.error('[GitHub] Network error:', fetchError);
    throw new Error(`Network error: ${fetchError instanceof Error ? fetchError.message : 'Failed to fetch'}`);
  }

  console.log('[GitHub] Response status:', response.status);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[GitHub] Error response:', errorText);
    throw new Error(`GitHub device flow failed: ${response.status} - ${errorText}`);
  }

  const data: GitHubDeviceCodeResponse = await response.json();
  console.log('[GitHub] Device flow started, user code:', data.user_code);

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresAt: Date.now() + data.expires_in * 1000,
    interval: data.interval,
  };
};

/**
 * Poll for access token after user authorizes
 */
export const pollForToken = async (
  deviceCode: string,
  interval: number,
  expiresAt: number,
  onPending?: () => void,
  signal?: AbortSignal
): Promise<OAuthTokens | null> => {
  const pollInterval = Math.max(interval, 5) * 1000; // Minimum 5 seconds
  const bridge = netcattyBridge.get();

  while (Date.now() < expiresAt) {
    await delayWithSignal(pollInterval, signal);
    throwIfAborted(signal);
    const pollId = createGitHubPollId();
    const cancelPoll = () => {
      void bridge?.githubCancelDeviceFlowPoll?.(pollId);
    };

    if (signal) {
      signal.addEventListener('abort', cancelPoll, { once: true });
    }

    try {
      let data;
      try {
        data = bridge?.githubPollDeviceFlowToken
          ? await bridge.githubPollDeviceFlowToken({
              clientId: SYNC_CONSTANTS.GITHUB_CLIENT_ID,
              deviceCode,
              pollId,
            })
          : await (async () => {
              const response = await fetch(SYNC_CONSTANTS.GITHUB_ACCESS_TOKEN_URL, {
                method: 'POST',
                signal,
                headers: {
                  'Accept': 'application/json',
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                  client_id: SYNC_CONSTANTS.GITHUB_CLIENT_ID,
                  device_code: deviceCode,
                  grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                }).toString(),
              });
              return response.json();
            })();
      } catch (error) {
        if (
          signal?.aborted ||
          (error instanceof Error &&
            (error.name === 'AbortError' || error.message.toLowerCase().includes('abort')))
        ) {
          throw createGitHubCancelError();
        }
        throw error;
      }

      throwIfAborted(signal);

      if (data.access_token) {
        return {
          accessToken: data.access_token,
          tokenType: data.token_type || 'bearer',
          scope: data.scope,
        };
      }

      if (data.error === 'authorization_pending') {
        onPending?.();
        continue;
      }

      if (data.error === 'slow_down') {
        // Increase interval as requested
        await delayWithSignal(5000, signal);
        continue;
      }

      if (data.error === 'expired_token') {
        throw new Error('Device code expired. Please try again.');
      }

      if (data.error === 'access_denied') {
        throw new Error('User denied authorization.');
      }

      if (data.error) {
        throw new Error(`GitHub auth error: ${data.error_description || data.error}`);
      }
    } finally {
      if (signal) {
        signal.removeEventListener('abort', cancelPoll);
      }
    }
  }

  throw new Error('Device code expired. Please try again.');
};

// ============================================================================
// User Info
// ============================================================================

/**
 * Get authenticated user info
 */
export const getUserInfo = async (
  accessToken: string,
  signal?: AbortSignal
): Promise<ProviderAccount> => {
  const response = await fetch(`${SYNC_CONSTANTS.GITHUB_API_BASE}/user`, {
    signal,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get user info: ${response.statusText}`);
  }

  const user: GitHubUser = await response.json();

  return {
    id: String(user.id),
    email: user.email || undefined,
    name: user.name || user.login,
    avatarUrl: user.avatar_url,
  };
};

/**
 * Validate access token is still valid
 */
export const validateToken = async (accessToken: string): Promise<boolean> => {
  try {
    const response = await fetch(`${SYNC_CONSTANTS.GITHUB_API_BASE}/user`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });
    return response.ok;
  } catch {
    return false;
  }
};

// ============================================================================
// Gist Operations
// ============================================================================

/**
 * Find existing Netcatty sync gist
 */
export const findSyncGist = async (
  accessToken: string,
  signal?: AbortSignal
): Promise<string | null> => {
  // List user's gists and find ours
  const response = await fetch(`${SYNC_CONSTANTS.GITHUB_API_BASE}/gists?per_page=100`, {
    signal,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to list gists: ${response.statusText}`);
  }

  const gists: GitHubGist[] = await response.json();
  
  const syncGist = gists.find(g => 
    g.description === SYNC_CONSTANTS.GIST_DESCRIPTION &&
    g.files[SYNC_CONSTANTS.SYNC_FILE_NAME]
  );

  return syncGist?.id || null;
};

/**
 * Create a new sync gist
 */
export const createSyncGist = async (
  accessToken: string,
  syncedFile: SyncedFile
): Promise<string> => {
  const response = await fetch(`${SYNC_CONSTANTS.GITHUB_API_BASE}/gists`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      description: SYNC_CONSTANTS.GIST_DESCRIPTION,
      public: false,
      files: {
        [SYNC_CONSTANTS.SYNC_FILE_NAME]: {
          content: JSON.stringify(syncedFile, null, 2),
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create gist: ${response.statusText}`);
  }

  const gist: GitHubGist = await response.json();
  return gist.id;
};

/**
 * Update existing sync gist
 */
export const updateSyncGist = async (
  accessToken: string,
  gistId: string,
  syncedFile: SyncedFile
): Promise<void> => {
  const response = await fetch(`${SYNC_CONSTANTS.GITHUB_API_BASE}/gists/${gistId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      files: {
        [SYNC_CONSTANTS.SYNC_FILE_NAME]: {
          content: JSON.stringify(syncedFile, null, 2),
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update gist: ${response.statusText}`);
  }
};

/**
 * GitHub's Gist REST API truncates each file's embedded `content` around 1 MB
 * and sets `truncated: true`. Full bodies must be fetched from `raw_url`
 * (issue #2643: JSON.parse on truncated content → "Unterminated string").
 */
const fetchGistRawContent = async (
  accessToken: string,
  rawUrl: string,
): Promise<string> => {
  const bridge = netcattyBridge.get();
  if (bridge?.githubDownloadGistRawContent) {
    return bridge.githubDownloadGistRawContent({ accessToken, rawUrl });
  }

  const response = await fetch(rawUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github.raw',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download full gist content: ${response.statusText}`);
  }

  return response.text();
};

const utf8ByteLength = (value: string): number =>
  new TextEncoder().encode(value).byteLength;

const gistFileNeedsRawFetch = (file: GitHubGistFile): boolean => {
  if (file.truncated) return true;
  // GitHub `size` is UTF-8 bytes; JS string `.length` is UTF-16 code units.
  if (
    typeof file.size === 'number' &&
    typeof file.content === 'string' &&
    file.size > utf8ByteLength(file.content)
  ) {
    return true;
  }
  return false;
};

const parseSyncedFileFromGistFile = async (
  accessToken: string,
  file: GitHubGistFile | undefined,
): Promise<SyncedFile | null> => {
  if (!file) return null;

  const tryParse = (raw: string): SyncedFile => JSON.parse(raw) as SyncedFile;

  if (gistFileNeedsRawFetch(file)) {
    if (!file.raw_url) {
      throw new Error(
        'GitHub Gist sync file is truncated and no raw URL is available. ' +
          'The vault may exceed GitHub Gist size limits.',
      );
    }
    return tryParse(await fetchGistRawContent(accessToken, file.raw_url));
  }

  if (!file.content) return null;

  try {
    return tryParse(file.content);
  } catch (error) {
    // Defensive path for incomplete embedded JSON without truncated=true (#2643).
    if (error instanceof SyntaxError && file.raw_url) {
      return tryParse(await fetchGistRawContent(accessToken, file.raw_url));
    }
    throw error;
  }
};

/**
 * Download sync file from gist
 */
export const downloadSyncGist = async (
  accessToken: string,
  gistId: string
): Promise<SyncedFile | null> => {
  const response = await fetch(`${SYNC_CONSTANTS.GITHUB_API_BASE}/gists/${gistId}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`Failed to download gist: ${response.statusText}`);
  }

  const gist: GitHubGist = await response.json();
  return parseSyncedFileFromGistFile(accessToken, gist.files[SYNC_CONSTANTS.SYNC_FILE_NAME]);
};

/**
 * Delete sync gist
 */
export const deleteSyncGist = async (
  accessToken: string,
  gistId: string
): Promise<void> => {
  const response = await fetch(`${SYNC_CONSTANTS.GITHUB_API_BASE}/gists/${gistId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to delete gist: ${response.statusText}`);
  }
};

/**
 * Get gist revision history
 */
export const getGistHistory = async (
  accessToken: string,
  gistId: string
): Promise<Array<{ version: string; date: Date }>> => {
  const response = await fetch(`${SYNC_CONSTANTS.GITHUB_API_BASE}/gists/${gistId}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get gist history: ${response.statusText}`);
  }

  const gist: GitHubGist = await response.json();

  return (gist.history || []).map(h => ({
    version: h.version,
    date: new Date(h.committed_at),
  }));
};

/**
 * Download a specific historical revision of the sync gist.
 * Uses `GET /gists/{gist_id}/{sha}` which returns the gist at that point
 * in time. Returns the raw SyncedFile (still encrypted) or null if the
 * revision does not contain the sync file.
 */
export const downloadGistRevision = async (
  accessToken: string,
  gistId: string,
  sha: string,
): Promise<SyncedFile | null> => {
  const response = await fetch(
    `${SYNC_CONSTANTS.GITHUB_API_BASE}/gists/${gistId}/${sha}`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    },
  );

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Failed to download gist revision: ${response.statusText}`);
  }

  const gist: GitHubGist = await response.json();
  return parseSyncedFileFromGistFile(accessToken, gist.files[SYNC_CONSTANTS.SYNC_FILE_NAME]);
};

// ============================================================================
// GitHub Adapter Class
// ============================================================================

export class GitHubAdapter {
  private accessToken: string | null = null;
  private gistId: string | null = null;
  private account: ProviderAccount | null = null;

  constructor(tokens?: OAuthTokens, gistId?: string) {
    if (tokens) {
      this.accessToken = tokens.accessToken;
    }
    this.gistId = gistId || null;
  }

  get isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  get accountInfo(): ProviderAccount | null {
    return this.account;
  }

  get resourceId(): string | null {
    return this.gistId;
  }

  /**
   * Start Device Flow authentication
   */
  async startAuth(): Promise<DeviceFlowState> {
    return startDeviceFlow();
  }

  /**
   * Complete authentication by polling for token
   */
  async completeAuth(
    deviceCode: string,
    interval: number,
    expiresAt: number,
    onPending?: () => void,
    signal?: AbortSignal
  ): Promise<OAuthTokens> {
    const tokens = await pollForToken(deviceCode, interval, expiresAt, onPending, signal);
    if (!tokens) {
      throw new Error('Failed to obtain access token');
    }

    throwIfAborted(signal);
    this.accessToken = tokens.accessToken;
    this.account = await getUserInfo(tokens.accessToken, signal);
    throwIfAborted(signal);

    return tokens;
  }

  /**
   * Set tokens from storage
   */
  async setTokens(tokens: OAuthTokens): Promise<void> {
    this.accessToken = tokens.accessToken;
    
    if (await validateToken(tokens.accessToken)) {
      this.account = await getUserInfo(tokens.accessToken);
    } else {
      throw new Error('Token is invalid or expired');
    }
  }

  /**
   * Sign out
   */
  signOut(): void {
    this.accessToken = null;
    this.gistId = null;
    this.account = null;
  }

  /**
   * Initialize or find sync gist
   */
  async initializeSync(signal?: AbortSignal): Promise<string | null> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    this.gistId = await findSyncGist(this.accessToken, signal);
    return this.gistId;
  }

  /**
   * Upload sync file
   */
  async upload(syncedFile: SyncedFile): Promise<string> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    if (this.gistId) {
      await updateSyncGist(this.accessToken, this.gistId, syncedFile);
      return this.gistId;
    } else {
      this.gistId = await createSyncGist(this.accessToken, syncedFile);
      return this.gistId;
    }
  }

  /**
   * Download sync file
   */
  async download(): Promise<SyncedFile | null> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    if (!this.gistId) {
      this.gistId = await findSyncGist(this.accessToken);
    }

    if (!this.gistId) {
      return null;
    }

    return downloadSyncGist(this.accessToken, this.gistId);
  }

  /**
   * Delete sync data
   */
  async deleteSync(): Promise<void> {
    if (!this.accessToken || !this.gistId) {
      return;
    }

    await deleteSyncGist(this.accessToken, this.gistId);
    this.gistId = null;
  }

  /**
   * Get revision history for the sync gist. Lazily discovers the gist
   * ID if it hasn't been resolved yet (same pattern as `download()`).
   */
  async getHistory(): Promise<Array<{ version: string; date: Date }>> {
    if (!this.accessToken) return [];
    if (!this.gistId) {
      this.gistId = await findSyncGist(this.accessToken);
    }
    if (!this.gistId) return [];
    return getGistHistory(this.accessToken, this.gistId);
  }

  /**
   * Download a specific historical revision of the sync gist (still
   * encrypted — the caller must decrypt it). Lazily discovers the
   * gist ID if needed.
   */
  async downloadRevision(sha: string): Promise<SyncedFile | null> {
    if (!this.accessToken) return null;
    if (!this.gistId) {
      this.gistId = await findSyncGist(this.accessToken);
    }
    if (!this.gistId) return null;
    return downloadGistRevision(this.accessToken, this.gistId, sha);
  }

  /**
   * Get tokens for storage
   */
  getTokens(): OAuthTokens | null {
    if (!this.accessToken) return null;
    return {
      accessToken: this.accessToken,
      tokenType: 'bearer',
    };
  }
}

export default GitHubAdapter;
