"use strict";

const DEFAULT_SESSION_TOMBSTONE_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_SESSION_TOMBSTONES = 4096;

class SessionTombstones {
  constructor(options = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_SESSION_TOMBSTONES;
    this.ttlMs = options.ttlMs ?? DEFAULT_SESSION_TOMBSTONE_TTL_MS;
    this.now = options.now ?? (() => Date.now());
    this.entries = new Map();
  }

  prune() {
    const now = this.now();
    for (const [sessionId, closedAt] of this.entries) {
      if (now - closedAt < this.ttlMs) break;
      this.entries.delete(sessionId);
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  add(sessionId) {
    if (!sessionId) return this;
    this.entries.delete(sessionId);
    this.entries.set(sessionId, this.now());
    this.prune();
    return this;
  }

  delete(sessionId) {
    return this.entries.delete(sessionId);
  }

  has(sessionId) {
    this.prune();
    return this.entries.has(sessionId);
  }

  get size() {
    this.prune();
    return this.entries.size;
  }

  [Symbol.iterator]() {
    this.prune();
    return this.entries.keys();
  }
}

module.exports = {
  DEFAULT_SESSION_TOMBSTONE_TTL_MS,
  DEFAULT_MAX_SESSION_TOMBSTONES,
  SessionTombstones,
};
