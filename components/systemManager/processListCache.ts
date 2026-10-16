import type { SystemProcessInfo } from '../../domain/systemManager/types';

export const PROCESS_LIST_CACHE_TTL_MS = 30_000;
export const PROCESS_LIST_CACHE_MAX_SESSIONS = 16;
export const PROCESS_LIST_CACHE_MAX_ROWS = 20_000;

type ProcessListCacheEntry = {
  processes: SystemProcessInfo[];
  updatedAt: number;
};

const processListCache = new Map<string, ProcessListCacheEntry>();

function pruneExpiredProcessLists(now = Date.now()): void {
  for (const [sessionId, entry] of processListCache) {
    if (now - entry.updatedAt > PROCESS_LIST_CACHE_TTL_MS) {
      processListCache.delete(sessionId);
    }
  }
}

function enforceProcessListCacheLimits(): void {
  let totalRows = 0;
  for (const entry of processListCache.values()) totalRows += entry.processes.length;
  while (
    processListCache.size > PROCESS_LIST_CACHE_MAX_SESSIONS
    || totalRows > PROCESS_LIST_CACHE_MAX_ROWS
  ) {
    const oldestSessionId = processListCache.keys().next().value as string | undefined;
    if (!oldestSessionId) break;
    const oldest = processListCache.get(oldestSessionId);
    processListCache.delete(oldestSessionId);
    totalRows -= oldest?.processes.length ?? 0;
  }
}

export function getCachedProcessList(sessionId: string): SystemProcessInfo[] | null {
  pruneExpiredProcessLists();
  const cached = processListCache.get(sessionId);
  if (!cached) return null;
  processListCache.delete(sessionId);
  processListCache.set(sessionId, cached);
  return cached.processes;
}

export function setCachedProcessList(
  sessionId: string,
  processes: SystemProcessInfo[],
  now = Date.now(),
): void {
  pruneExpiredProcessLists(now);
  processListCache.delete(sessionId);
  if (processes.length > PROCESS_LIST_CACHE_MAX_ROWS) return;
  processListCache.set(sessionId, { processes, updatedAt: now });
  enforceProcessListCacheLimits();
}

export function clearCachedProcessList(sessionId: string): void {
  processListCache.delete(sessionId);
}

export function resetProcessListCacheForTests(): void {
  processListCache.clear();
}

export function getProcessListCacheStatsForTests(): {
  sessions: number;
  rows: number;
  sessionIds: string[];
} {
  return {
    sessions: processListCache.size,
    rows: [...processListCache.values()].reduce((sum, entry) => sum + entry.processes.length, 0),
    sessionIds: [...processListCache.keys()],
  };
}
