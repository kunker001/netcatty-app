# Issue #2280: Port forwarding runtime state research

Research date: 2026-07-17

Scope: Netcatty v1.1.68 and the current main branch, including start, stop,
auto-start, multi-window synchronization, and backend lifecycle behavior.
External comparisons use official source code or documentation only.

## Conclusion

Issue #2280 was not a display delay. After auto-start succeeded, the real
connection status was written to localStorage but did not update the in-memory
state observed by the current window. A browser storage event is not delivered
back to the window that made the write. The page therefore remained inactive
while both the backend tunnel and the renderer connection record were active.

The four-second reconciliation also could not repair the page because the
backend and renderer connection maps already agreed. A second Start click was
treated as an idempotent success, but it did not republish the active status.
This exactly matches the report: the tunnel was running, the page showed it as
stopped, and the user could not stop it from that page.

Original reproduction and screenshots: [Issue #2280](https://github.com/binaricat/Netcatty/issues/2280).
The relevant lifecycle was unchanged between v1.1.68 and the inspected main
branch.

## Existing state model

Four state copies were involved:

1. The Electron main process owned real SSH connections and listeners in
   `portForwardingTunnels`.
2. Each renderer kept another runtime map in `activeConnections`.
3. React rendered `globalRules[].status`.
4. The persisted rule objects also contained `status` and `error`.

The system therefore depended on synchronization among four copies instead of
one runtime source of truth.

## Deterministic failure path

Auto-start called the low-level start service directly. Its status callback
only updated localStorage. The current window listened to native storage events,
which only arrive for writes made by other windows.

The stable broken state was:

1. The main-process tunnel was active.
2. The renderer runtime connection was active.
3. The React rule remained inactive, so the card offered Start instead of Stop.
4. Reconciliation saw no backend-to-renderer difference and skipped the UI
   refresh.
5. Another Start call reused the existing tunnel without repairing the UI.

## Additional accuracy risks found during investigation

- A failed stop could be displayed as inactive even when backend cleanup failed.
- Two windows could race to create duplicate tunnels for the same rule.
- Recovery depended on parsing a rule ID from a generated tunnel ID even though
  the backend already stored the explicit rule ID.
- A backend query failure could leave stale state with no way to express that
  the current state was unknown.
- A newly opened window could adopt an existing tunnel but miss a status event
  during the reply-to-subscription handoff.
- Cleanup errors, reconnect timers, storage writes, and heartbeat reconciliation
  could overwrite one another and produce false active, inactive, or connecting
  states.

## Comparison with mature projects

### OpenSSH

OpenSSH `ExitOnForwardFailure=yes` treats listener setup failure as connection
failure. When backgrounding is requested, it waits for forwarding setup before
entering the background. This supports a strict rule: active must come from a
confirmed listener or remote-forward result, never from a persisted flag or a
button click.

Source: [OpenBSD ssh_config(5)](https://man.openbsd.org/ssh_config.5#ExitOnForwardFailure).

### Tabby

Tabby adds a local or dynamic forward to its runtime collection only after the
listener emits `listening`. A remote forward is added only after the server
confirms it. Stop closes the real resource and removes it from the same runtime
collection. Session teardown closes all remaining listeners.

Sources: [addPortForward and removePortForward](https://github.com/Eugeny/tabby/blob/14e2d60b9b6dee84a53c37f05eefeb803787de04/tabby-ssh/src/session/ssh.ts#L786-L845),
[ForwardedPort](https://github.com/Eugeny/tabby/blob/14e2d60b9b6dee84a53c37f05eefeb803787de04/tabby-ssh/src/session/forwards.ts#L6-L54),
and [session cleanup](https://github.com/Eugeny/tabby/blob/14e2d60b9b6dee84a53c37f05eefeb803787de04/tabby-ssh/src/session/ssh.ts#L146-L150).

### VS Code

VS Code's tunnel service owns one runtime map and exposes tunnel-opened and
tunnel-closed events to consumers. It publishes opened only after a provider
returns a real tunnel. Failed opens are removed from the map. Final release
waits for disposal, removes the runtime entry, and then publishes closed.

Sources: [service contract](https://github.com/microsoft/vscode/blob/b1b978c118c517376df3d95696201265e0d84264/src/vs/platform/tunnel/common/tunnel.ts#L120-L144),
[runtime map](https://github.com/microsoft/vscode/blob/b1b978c118c517376df3d95696201265e0d84264/src/vs/platform/tunnel/common/tunnel.ts#L224-L238),
[open flow](https://github.com/microsoft/vscode/blob/b1b978c118c517376df3d95696201265e0d84264/src/vs/platform/tunnel/common/tunnel.ts#L352-L399),
and [close flow](https://github.com/microsoft/vscode/blob/b1b978c118c517376df3d95696201265e0d84264/src/vs/platform/tunnel/common/tunnel.ts#L401-L466).

### Electerm

Electerm resolves local forwarding only after the listener starts and rejects
listener failures. SSH close destroys active sockets and closes the listener;
dynamic forwarding similarly closes its SOCKS server with the SSH connection.

Sources: [SSH tunnel lifecycle](https://github.com/electerm/electerm/blob/6fbddfe55c66bffcb5aaad23676c0dd006e16367/src/app/server/ssh-tunnel.js#L78-L139)
and [SOCKS lifecycle](https://github.com/electerm/electerm/blob/6fbddfe55c66bffcb5aaad23676c0dd006e16367/src/app/server/ssh-tunnel.js#L142-L202).

## Applied design direction

The fix follows these principles:

1. The rule ID is the durable identity. Tunnel IDs identify attempts only.
2. The backend owns and deduplicates real runtime tunnels by rule ID.
3. Existing tunnels can be adopted by another window, which receives later
   status changes and verifies a fresh snapshot after subscribing.
4. Same-window and cross-window writes merge configuration with known runtime
   state instead of blindly replacing it.
5. Stop publishes inactive only after successful backend cleanup. Failure stays
   visible and retryable.
6. Reconnect timers survive the expected error-close-reconcile sequence but are
   suppressed after a manual stop attempt.
7. Reconciliation repairs displayed state even when the renderer runtime map did
   not otherwise change.

## Required validation matrix

- Auto-start: inactive -> connecting -> active is visible in the same window.
- Close the main window while keeping the tray process, reopen it, and verify the
  page matches the listener and can stop it.
- Full exit and restart creates only one new auto-start instance.
- Two windows starting the same rule result in one backend tunnel and matching
  active state in both windows.
- A missed cross-window event is repaired by a fresh backend snapshot.
- Port conflicts, SSH handshake failures, and rejected remote forwards never
  display active.
- Cleanup failure never displays inactive and Stop remains retryable.
- Unexpected SSH close with auto-reconnect follows active -> connecting ->
  active/error without a ghost active state.
- Imported non-UUID rule IDs can be recovered, reconciled, and stopped.
- Temporary backend-list failure does not turn unknown state into inactive.

## Completion criteria

Validation must prove agreement among the main-process runtime instance, the
renderer runtime snapshot, the visible rule state, and the available button
action. A real TCP listener should be reachable while active and released while
inactive. A localStorage status assertion alone is not sufficient.
