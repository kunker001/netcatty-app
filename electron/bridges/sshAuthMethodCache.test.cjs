"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MAX_SSH_AUTH_METHOD_CACHE_ENTRIES,
  createSshAuthMethodCache,
} = require("./sshAuthMethodCache.cjs");

test("auth method cache stays hard-bounded across thousands of endpoints", () => {
  const cache = createSshAuthMethodCache();
  for (let index = 0; index < 4_000; index += 1) {
    cache.set(`root@host-${index}:22`, { method: "publickey" });
  }

  assert.equal(cache.size, MAX_SSH_AUTH_METHOD_CACHE_ENTRIES);
  assert.equal(cache.get("root@host-0:22"), undefined);
  assert.deepEqual(cache.get("root@host-3999:22"), { method: "publickey" });
});

test("auth method cache refreshes recency on successful lookup", () => {
  const cache = createSshAuthMethodCache({ maxEntries: 3 });
  cache.set("a", { method: "password" });
  cache.set("b", { method: "publickey" });
  cache.set("c", { method: "publickey-default" });

  assert.equal(cache.get("a")?.method, "password");
  cache.set("d", { method: "password" });

  assert.equal(cache.get("b"), undefined, "least-recently-used endpoint should be evicted");
  assert.equal(cache.get("a")?.method, "password", "cache hit must protect the refreshed endpoint");
  assert.equal(cache.size, 3);
});
