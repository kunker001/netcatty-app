/**
 * Passphrase Handler - Handles passphrase requests for encrypted SSH keys
 * This module provides a mechanism to request passphrase input from the user
 * when encountering encrypted default SSH keys in ~/.ssh
 */

// Passphrase request pending map
// Map of requestId -> { resolveCallback, webContentsId, keyPath, createdAt, timeoutId, sender, signal, abortHandler }
const { randomUUID } = require("node:crypto");

const passphraseRequests = new Map();

// TTL for abandoned requests (2 minutes)
const REQUEST_TTL_MS = 2 * 60 * 1000;

/**
 * Generate a unique request ID for passphrase requests
 */
function generateRequestId(prefix = 'pp') {
  return `${prefix}-${randomUUID()}`;
}

/**
 * Request passphrase from user via IPC
 * @param {Object} sender - Electron webContents sender
 * @param {string} keyPath - Path to the encrypted key
 * @param {string} keyName - Name of the key (e.g., id_rsa)
 * @param {string} [hostname] - Optional hostname for context
 * @returns {Promise<{ passphrase?: string, cancelled?: boolean, skipped?: boolean } | null>}
 */
function settleRequest(requestId, result, notification) {
  const pending = passphraseRequests.get(requestId);
  if (!pending) return false;

  if (pending.timeoutId) {
    clearTimeout(pending.timeoutId);
  }
  if (pending.signal && pending.abortHandler) {
    pending.signal.removeEventListener("abort", pending.abortHandler);
  }

  passphraseRequests.delete(requestId);

  if (notification) {
    try {
      if (!pending.sender?.isDestroyed?.()) {
        pending.sender?.send?.(notification.channel, {
          requestId,
          ...(notification.payload || {}),
        });
      }
    } catch (err) {
      console.warn(`[Passphrase] Failed to send ${notification.channel} notification:`, err.message);
    }
  }

  pending.resolveCallback(result);
  return true;
}

function cancelPassphraseRequest(requestId, reason = "cancelled") {
  const cancelled = settleRequest(
    requestId,
    { cancelled: true },
    {
      channel: "netcatty:passphrase-cancelled",
      payload: { reason },
    }
  );
  if (cancelled) {
    console.log(`[Passphrase] Request ${requestId} cancelled by ${reason}`);
  }
  return cancelled;
}

function cancelPassphraseRequestsForSession(sessionId, reason = "session-closed", bootEpoch) {
  if (!sessionId) return 0;
  const requestedEpoch = Number.isFinite(bootEpoch) ? Number(bootEpoch) : undefined;
  let cancelled = 0;
  for (const [requestId, pending] of [...passphraseRequests.entries()]) {
    if (pending.sessionId !== sessionId) continue;
    // A stale close for an older boot must not cancel a newer reconnect's prompt.
    if (
      requestedEpoch !== undefined
      && Number.isFinite(pending.bootEpoch)
      && pending.bootEpoch > requestedEpoch
    ) {
      continue;
    }
    if (cancelPassphraseRequest(requestId, reason)) cancelled += 1;
  }
  return cancelled;
}

function requestPassphrase(sender, keyPath, keyName, hostname, passphraseInvalid, options = {}) {
  return new Promise((resolve) => {
    if (!sender || sender.isDestroyed()) {
      console.warn('[Passphrase] Sender is destroyed, cannot request passphrase');
      resolve(null);
      return;
    }

    const signal = options?.signal;
    if (signal?.aborted) {
      resolve({ cancelled: true });
      return;
    }
    
    const requestId = generateRequestId();
    
    // Set up TTL timeout to clean up abandoned requests
    const timeoutId = setTimeout(() => {
      if (passphraseRequests.has(requestId)) {
        console.warn(`[Passphrase] Request ${requestId} timed out after ${REQUEST_TTL_MS / 1000}s`);
        settleRequest(
          requestId,
          null,
          { channel: "netcatty:passphrase-timeout" }
        );
      }
    }, REQUEST_TTL_MS);

    const abortHandler = () => {
      cancelPassphraseRequest(requestId, "external-cancel");
    };
    
    passphraseRequests.set(requestId, {
      resolveCallback: resolve,
      sender,
      webContentsId: sender.id,
      keyPath,
      keyName,
      sessionId: typeof options.sessionId === "string" ? options.sessionId : undefined,
      bootEpoch: Number.isFinite(options.bootEpoch) ? Number(options.bootEpoch) : undefined,
      createdAt: Date.now(),
      timeoutId,
      signal,
      abortHandler: signal ? abortHandler : null,
    });

    if (signal) {
      signal.addEventListener("abort", abortHandler, { once: true });
    }
    
    console.log(`[Passphrase] Requesting passphrase for ${keyName} (${requestId})`);
    
    try {
      sender.send('netcatty:passphrase-request', {
        requestId,
        keyPath,
        keyName,
        hostname,
        passphraseInvalid: !!passphraseInvalid,
        ...(typeof options.sessionId === "string" ? { sessionId: options.sessionId } : {}),
        ...(Number.isFinite(options.bootEpoch) ? { bootEpoch: Number(options.bootEpoch) } : {}),
      });
    } catch (err) {
      console.error('[Passphrase] Failed to send passphrase request:', err);
      settleRequest(requestId, null);
    }
  });
}

/**
 * Handle passphrase response from renderer
 */
function handleResponse(_event, payload) {
  const { requestId, passphrase, cancelled, skipped } = payload;
  const pending = passphraseRequests.get(requestId);
  
  if (!pending) {
    console.warn(`[Passphrase] No pending request for ${requestId}`);
    return { success: false, error: 'Request not found' };
  }

  if (_event?.sender?.id !== pending.webContentsId) {
    console.warn(`[Passphrase] Wrong sender for request ${requestId}`);
    return { success: false, error: 'Wrong sender' };
  }
  
  if (cancelled) {
    // User clicked Cancel - stop the entire passphrase flow
    console.log(`[Passphrase] Request ${requestId} cancelled by user`);
    settleRequest(requestId, { cancelled: true });
  } else if (skipped) {
    // User clicked Skip - skip this key but continue with others
    console.log(`[Passphrase] Request ${requestId} skipped by user`);
    settleRequest(requestId, { skipped: true });
  } else {
    console.log(`[Passphrase] Received passphrase for ${requestId}`);
    settleRequest(requestId, { passphrase: passphrase || null });
  }
  
  return { success: true };
}

/**
 * Register IPC handler for passphrase responses
 */
function registerHandler(ipcMain) {
  ipcMain.handle('netcatty:passphrase:respond', handleResponse);
}

/**
 * Get pending requests (for debugging)
 */
function getRequests() {
  return passphraseRequests;
}

module.exports = {
  generateRequestId,
  requestPassphrase,
  cancelPassphraseRequest,
  cancelPassphraseRequestsForSession,
  handleResponse,
  registerHandler,
  getRequests,
};
