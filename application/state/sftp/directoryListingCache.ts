import type { SftpFileEntry } from "../../../domain/models";

export interface DirectoryListingCacheEntry {
  files: SftpFileEntry[];
  timestamp: number;
}

export type DirectoryListingCache = Map<string, DirectoryListingCacheEntry>;

export const MAX_DIRECTORY_CACHE_ENTRIES = 128;
export const MAX_DIRECTORY_CACHE_FILES = 20_000;

function removeExpiredEntries(
  cache: DirectoryListingCache,
  now: number,
  ttlMs: number,
): void {
  for (const [key, entry] of cache) {
    if (now - entry.timestamp >= ttlMs) cache.delete(key);
  }
}

export function getDirectoryCacheEntry(
  cache: DirectoryListingCache,
  key: string,
  now: number,
  ttlMs: number,
): DirectoryListingCacheEntry | undefined {
  removeExpiredEntries(cache, now, ttlMs);
  const entry = cache.get(key);
  if (!entry) return undefined;
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

export function setDirectoryCacheEntry(
  cache: DirectoryListingCache,
  key: string,
  entry: DirectoryListingCacheEntry,
  options: {
    now?: number;
    ttlMs?: number;
    maxEntries?: number;
    maxFiles?: number;
  } = {},
): void {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? 10_000;
  const maxEntries = options.maxEntries ?? MAX_DIRECTORY_CACHE_ENTRIES;
  const maxFiles = options.maxFiles ?? MAX_DIRECTORY_CACHE_FILES;
  removeExpiredEntries(cache, now, ttlMs);
  cache.delete(key);
  // A cache budget must remain a hard bound. Truncating a directory listing
  // would be incorrect, so oversized listings are served to the caller but
  // deliberately not retained.
  if (entry.files.length > maxFiles || maxEntries < 1) return;
  cache.set(key, entry);

  let totalFiles = 0;
  for (const value of cache.values()) totalFiles += value.files.length;
  while (cache.size > 1 && (cache.size > maxEntries || totalFiles > maxFiles)) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = cache.get(oldestKey);
    cache.delete(oldestKey);
    totalFiles -= oldest?.files.length ?? 0;
  }
}
