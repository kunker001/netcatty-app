"use strict";

const MAX_SSH_AUTH_METHOD_CACHE_ENTRIES = 512;

function createSshAuthMethodCache(options = {}) {
  const maxEntries = Number.isFinite(options.maxEntries)
    ? Math.max(1, Math.floor(options.maxEntries))
    : MAX_SSH_AUTH_METHOD_CACHE_ENTRIES;
  const entries = new Map();

  return {
    get size() {
      return entries.size;
    },
    get(key) {
      const value = entries.get(key);
      if (value === undefined) return undefined;
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey === undefined) break;
        entries.delete(oldestKey);
      }
      return this;
    },
    delete(key) {
      return entries.delete(key);
    },
    clear() {
      entries.clear();
    },
  };
}

module.exports = {
  MAX_SSH_AUTH_METHOD_CACHE_ENTRIES,
  createSshAuthMethodCache,
};
