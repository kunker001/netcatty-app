import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_SHARED_REMOTE_HOST_CACHE_ENTRIES,
  MAX_SHARED_REMOTE_HOST_CACHE_FILES,
  _getSharedRemoteHostCacheStatsForTests,
  _resetSharedRemoteHostCacheForTests,
  getSharedRemoteHostCache,
  setSharedRemoteHostCache,
} from "./sharedRemoteHostCache";

const files = (count: number) => Array.from({ length: count }, (_value, index) => ({
  name: `file-${index}`,
})) as never[];

const entry = (fileCount: number) => ({
  path: "/",
  homeDir: "/",
  files: files(fileCount),
  filenameEncoding: "utf-8" as const,
});

test("shared host cache is bounded across many different hosts", () => {
  _resetSharedRemoteHostCacheForTests();
  for (let index = 0; index < MAX_SHARED_REMOTE_HOST_CACHE_ENTRIES + 20; index += 1) {
    setSharedRemoteHostCache(`host-${index}`, entry(1));
  }

  assert.equal(_getSharedRemoteHostCacheStatsForTests().entries, MAX_SHARED_REMOTE_HOST_CACHE_ENTRIES);
  assert.equal(getSharedRemoteHostCache("host-0"), null);
  assert.ok(getSharedRemoteHostCache(`host-${MAX_SHARED_REMOTE_HOST_CACHE_ENTRIES + 19}`));
});

test("shared host cache is bounded by retained file rows", () => {
  _resetSharedRemoteHostCacheForTests();
  const perHost = Math.floor(MAX_SHARED_REMOTE_HOST_CACHE_FILES * 0.6);
  setSharedRemoteHostCache("large-a", entry(perHost));
  setSharedRemoteHostCache("large-b", entry(perHost));

  assert.deepEqual(_getSharedRemoteHostCacheStatsForTests(), {
    entries: 1,
    files: perHost,
  });
  assert.equal(getSharedRemoteHostCache("large-a"), null);
  assert.ok(getSharedRemoteHostCache("large-b"));
});

test("shared host cache skips one listing larger than the global file budget", () => {
  _resetSharedRemoteHostCacheForTests();
  setSharedRemoteHostCache("oversized", entry(MAX_SHARED_REMOTE_HOST_CACHE_FILES + 1));

  assert.deepEqual(_getSharedRemoteHostCacheStatsForTests(), {
    entries: 0,
    files: 0,
  });
  assert.equal(getSharedRemoteHostCache("oversized"), null);
});
