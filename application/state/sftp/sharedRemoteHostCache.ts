import type { SftpFileEntry, SftpFilenameEncoding } from "../../../domain/models";

export interface SharedRemoteHostCacheEntry {
  path: string;
  homeDir: string;
  files: SftpFileEntry[];
  filenameEncoding: SftpFilenameEncoding;
  updatedAt: number;
}

const SHARED_REMOTE_HOST_CACHE_TTL_MS = 60_000;
export const MAX_SHARED_REMOTE_HOST_CACHE_ENTRIES = 64;
export const MAX_SHARED_REMOTE_HOST_CACHE_FILES = 20_000;

const sharedRemoteHostCache = new Map<string, SharedRemoteHostCacheEntry>();

const pruneSharedRemoteHostCache = (now: number): void => {
  for (const [key, entry] of sharedRemoteHostCache) {
    if (now - entry.updatedAt > SHARED_REMOTE_HOST_CACHE_TTL_MS) {
      sharedRemoteHostCache.delete(key);
    }
  }

  let totalFiles = 0;
  for (const entry of sharedRemoteHostCache.values()) totalFiles += entry.files.length;
  while (
    sharedRemoteHostCache.size > 1
    && (
      sharedRemoteHostCache.size > MAX_SHARED_REMOTE_HOST_CACHE_ENTRIES
      || totalFiles > MAX_SHARED_REMOTE_HOST_CACHE_FILES
    )
  ) {
    const oldestKey = sharedRemoteHostCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = sharedRemoteHostCache.get(oldestKey);
    sharedRemoteHostCache.delete(oldestKey);
    totalFiles -= oldest?.files.length ?? 0;
  }
};

/**
 * Build a cache key that includes connection details so that the same host ID
 * with different session-time overrides (port, protocol) uses separate entries.
 */
export const buildCacheKey = (
  hostId: string,
  hostname?: string,
  port?: number,
  protocol?: string,
  sftpSudo?: boolean,
  username?: string,
  sftpFileProtocol?: string,
): string => {
  const fileProto = sftpFileProtocol && sftpFileProtocol !== "auto" ? sftpFileProtocol : "";
  return `${hostId}:${hostname ?? ''}:${port ?? ''}:${protocol ?? ''}:${sftpSudo ? 'sudo' : ''}:${username ?? ''}:${fileProto}`;
};

export const getSharedRemoteHostCache = (
  cacheKey: string,
): SharedRemoteHostCacheEntry | null => {
  pruneSharedRemoteHostCache(Date.now());
  const entry = sharedRemoteHostCache.get(cacheKey);
  if (!entry) return null;
  sharedRemoteHostCache.delete(cacheKey);
  sharedRemoteHostCache.set(cacheKey, entry);
  return entry;
};

export const setSharedRemoteHostCache = (
  cacheKey: string,
  entry: Omit<SharedRemoteHostCacheEntry, "updatedAt">,
): void => {
  const now = Date.now();
  pruneSharedRemoteHostCache(now);
  sharedRemoteHostCache.delete(cacheKey);
  // Never exceed the advertised file-row budget with a single huge listing.
  // Dropping it from cache preserves the full result for this read without
  // retaining an unbounded array for the lifetime of the renderer.
  if (entry.files.length > MAX_SHARED_REMOTE_HOST_CACHE_FILES) return;
  sharedRemoteHostCache.set(cacheKey, {
    ...entry,
    updatedAt: now,
  });
  pruneSharedRemoteHostCache(now);
};

export const _resetSharedRemoteHostCacheForTests = (): void => {
  sharedRemoteHostCache.clear();
};

export const _getSharedRemoteHostCacheStatsForTests = () => ({
  entries: sharedRemoteHostCache.size,
  files: [...sharedRemoteHostCache.values()].reduce((sum, entry) => sum + entry.files.length, 0),
});
