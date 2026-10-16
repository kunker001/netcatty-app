"use strict";

/**
 * A timed-out SSH channel-open request cannot be cancelled through ssh2's
 * public API. ssh2 retains the request callback in its channel manager until
 * the server replies or the physical socket closes, so merely rejecting the
 * caller would leak one pending channel per retry on a wedged transport.
 *
 * Invalidate the physical connection to make ssh2 run its channel-manager
 * cleanup. The shared transport registry observes the resulting close event
 * and removes the transport from every reuse index.
 */
function invalidateSshTransport(sshClient) {
  if (!sshClient) return false;
  try { sshClient.once?.("error", () => {}); } catch { /* ignore */ }
  let attempted = false;
  try {
    if (typeof sshClient.end === "function") {
      attempted = true;
      sshClient.end();
    }
  } catch { /* continue with hard destroy */ }
  try {
    if (typeof sshClient.destroy === "function") {
      attempted = true;
      sshClient.destroy();
    }
  } catch { /* transport may already be closing */ }
  return attempted;
}

module.exports = { invalidateSshTransport };
