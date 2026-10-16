import assert from "node:assert/strict";
import test from "node:test";
import {
  getDirectoryCacheEntry,
  setDirectoryCacheEntry,
  type DirectoryListingCache,
} from "./directoryListingCache";

const files = (count: number) => Array.from({ length: count }, (_value, index) => ({
  name: `file-${index}`,
})) as never[];

test("directory cache removes expired entries when it is read", () => {
  const cache: DirectoryListingCache = new Map([
    ["expired", { files: files(1), timestamp: 0 }],
    ["fresh", { files: files(1), timestamp: 95 }],
  ]);

  assert.equal(getDirectoryCacheEntry(cache, "fresh", 100, 10)?.files.length, 1);
  assert.equal(cache.has("expired"), false);
});

test("directory cache evicts least-recently-used listings by entry count", () => {
  const cache: DirectoryListingCache = new Map();
  setDirectoryCacheEntry(cache, "a", { files: files(1), timestamp: 1 }, { now: 1, ttlMs: 1_000, maxEntries: 2 });
  setDirectoryCacheEntry(cache, "b", { files: files(1), timestamp: 2 }, { now: 2, ttlMs: 1_000, maxEntries: 2 });
  assert.ok(getDirectoryCacheEntry(cache, "a", 3, 1_000));
  setDirectoryCacheEntry(cache, "c", { files: files(1), timestamp: 4 }, { now: 4, ttlMs: 1_000, maxEntries: 2 });

  assert.deepEqual([...cache.keys()], ["a", "c"]);
});

test("directory cache bounds retained file rows", () => {
  const cache: DirectoryListingCache = new Map();
  setDirectoryCacheEntry(cache, "large-a", { files: files(6), timestamp: 1 }, { now: 1, ttlMs: 1_000, maxFiles: 10 });
  setDirectoryCacheEntry(cache, "large-b", { files: files(6), timestamp: 2 }, { now: 2, ttlMs: 1_000, maxFiles: 10 });

  assert.deepEqual([...cache.keys()], ["large-b"]);
});

test("directory cache does not retain one listing larger than the file budget", () => {
  const cache: DirectoryListingCache = new Map();
  setDirectoryCacheEntry(
    cache,
    "oversized",
    { files: files(11), timestamp: 1 },
    { now: 1, ttlMs: 1_000, maxFiles: 10 },
  );

  assert.equal(cache.has("oversized"), false);
});
