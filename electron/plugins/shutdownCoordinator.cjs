"use strict";

const {
  PLUGIN_DEACTIVATION_TIMEOUT_MS,
  PLUGIN_UTILITY_FORCE_EXIT_TIMEOUT_MS,
  PLUGIN_UTILITY_TERMINATION_GRACE_MS,
} = require("./constants.cjs");

const shutdownHandlers = new Set();
let shutdownPromise = null;

function registerPluginShutdown(handler) {
  if (typeof handler !== "function") throw new TypeError("Plugin shutdown handler must be a function");
  shutdownHandlers.add(handler);
  shutdownPromise = null;
  return () => {
    shutdownHandlers.delete(handler);
  };
}

function runPluginShutdown(options = {}) {
  if (shutdownPromise) return shutdownPromise;
  if (shutdownHandlers.size === 0) return Promise.resolve({ timedOut: false });
  const timeoutMs = options.timeoutMs
    ?? PLUGIN_DEACTIVATION_TIMEOUT_MS
      + PLUGIN_UTILITY_TERMINATION_GRACE_MS
      + PLUGIN_UTILITY_FORCE_EXIT_TIMEOUT_MS
      + 500;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  shutdownPromise = Promise.race([
    Promise.allSettled([...shutdownHandlers].map((handler) => Promise.resolve().then(handler)))
      .then((results) => {
        const failed = results.find((result) => result.status === "rejected");
        if (failed) throw failed.reason;
        return { timedOut: false };
      }),
    timeout,
  ]).finally(() => clearTimeout(timer));
  return shutdownPromise;
}

function resetPluginShutdownForTests() {
  shutdownHandlers.clear();
  shutdownPromise = null;
}

module.exports = {
  registerPluginShutdown,
  resetPluginShutdownForTests,
  runPluginShutdown,
};
