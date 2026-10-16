# Plugin runtime extension boundaries

Status: phase 3 internal architecture review

This document records the host-runtime decisions that later plugin-platform
phases are allowed to depend on. The goal is to keep permission, contribution,
terminal, connection, synchronization, and distribution work out of the
runtime lifecycle core while still giving those phases stable internal seams.

These are host-internal APIs, not the public plugin API. The public contract
remains `0.1.0-internal` until the phase-9 API 1.0 freeze.

## Runtime identity is the authority root

Every activation receives a new host-generated runtime ID. The identity used by
host handlers contains the plugin ID, active version, runtime kind, package
root, manifest, logger, and host-resolved security principal. It is captured when the runtime starts and cannot be
supplied or replaced by plugin messages.

The RPC registry adds this identity to every request, notification, middleware
call, and incoming stream. A later permission decision can therefore bind a
grant to all of the following without trusting payload fields:

- plugin ID and version;
- one activation (`runtimeId`) for once/session grants;
- browser or advanced utility placement;
- declared manifest permissions and resources;
- the unsigned or later verified publisher security principal;
- the request cancellation and deadline context.

Host-to-plugin calls also verify that the recorded activation still matches the
database's enabled active version. An update cannot accidentally deliver a
command or Provider request to the old version after the active-version pointer
has moved.

Placement resolution and activation repeat that version check after every
asynchronous policy or startup boundary. A late crash or startup failure from
an old version is emitted for cleanup and diagnostics but cannot increment the
replacement version's crash counter, quarantine it, or overwrite its runtime
state. If the old immutable version is still installed, the event updates that
version's own runtime and crash state so a later rollback cannot mistake it for
a clean or still-running release.

## One capability registry, two message classes

`PluginHostRpcRegistry` is the composition point for plugin-to-host authority.
It deliberately distinguishes request handlers from notification handlers.
Storage mutations cannot be invoked as fire-and-forget notifications, and the
logging notification cannot be converted into a request with a meaningful
result. Reserved lifecycle and transport methods cannot be registered as
capabilities.

Registrations have unique method ownership and may carry immutable metadata.
Each registration may also provide a synchronous, side-effect-free parameter
validator. It runs before middleware, so resource extraction, permission
decisions, quotas, and audit records always consume the method's normalized
parameter shape instead of attacker-controlled raw input. Middleware then runs
immediately before the final handler with the host identity, method, validated
parameters, metadata, cancellation signal, request ID, and deadline.
Phase 3 installs permission, quota, audit, and fail-closed UI mediation here,
at the final privileged boundary rather than in renderer components.
Handler metadata is recursively copied and frozen when registered. Runtime
identity is checked before middleware, again after any asynchronous middleware
(such as an approval prompt), and once more before a result leaves the route.
An old activation therefore cannot resume a privileged handler after an update,
disable, quarantine, or stop transition.

Asynchronous handlers also receive `context.assertActive()`. A handler that
prepares I/O and then commits a mutation must call it immediately before the
commit and honor `context.signal` while waiting. The guard checks both the
host-owned activation identity and the request cancellation signal, so a
timed-out approval or Provider operation cannot commit merely because the same
plugin version remains active. Cancellation cannot undo a side effect already
issued to an external service, so this commit guard is part of the
capability-handler contract.

A running activation uses a route snapshot. Registering a new host subsystem
does not mutate a live plugin's authority invisibly; it applies on the next
activation. This is important when a new Netcatty build adds a capability or a
grant changes the available surface.

Capability middleware is not the transport quota boundary: reserved progress,
cancellation, lifecycle, and stream frames do not enter a business-method
handler. The supervisor therefore binds an optional synchronous raw-message
guard to the same host-generated runtime identity. It runs before JSON budget
walking and protocol dispatch for every message class. Phase 3 uses this seam
for per-activation rate and resource accounting, while capability middleware
continues to own permission and operation-specific policy. The guard must be
synchronous so an untrusted message cannot accumulate an unbounded queue of
pending quota decisions.

## Bidirectional invocation and validation

`RuntimeSupervisor.request()`, `notify()`, and `openStream()` are the only
general host-to-plugin entrypoints. All three can bind work to the exact
authorized runtime identity; streams repeat that check before opening and
again after the runtime returns the handle. Browser and utility runtimes
implement the same methods over their private router. Later registries do not
reach into a runtime window, utility process, MessagePort, or router.

Router requests may carry a reviewed structured-clone transfer list. This is
used to establish privileged terminal interceptor ports while retaining one
owner for correlation, deadlines, cancellation, validation, late responses,
close cleanup, and protocol-failure containment. After the attachment request
is accepted, terminal bytes travel only on the transferred dedicated port and
do not enter the JSON-RPC control plane.

Outgoing requests accept a method-specific result validator. Command and
Provider adapters must validate their exact public result schema before using
plugin data. The generic JSON boundary remains the first structural limit, not
a substitute for operation-level validation. Connection Providers additionally
validate the operation-specific result map: `resize`, `signal`, `reconnect`,
and `close` must return JSON `null`; `getStatus` must return a bounded
`ConnectionStatusResult` object and may attach structured diagnostics. Status
diagnostics are propagated through the host-owned terminal finish route so
later disconnect, reconnect, or authentication failures remain visible after
the initial `open` response.

Control-plane JSON is limited to 1 MiB. Large command results, importer data,
sync objects, terminal snapshots, and connection traffic must use the bounded
stream transport rather than raising this limit. A cancelled request ID remains
temporarily retired until one possible late response is discarded, so a slow
provider cannot accidentally answer a newer request after ID wraparound.

Lifecycle methods and `$/` transport methods are excluded from the general
entrypoints. Only the supervisor may initialize, activate, deactivate, cancel,
or account for a runtime.

## Stream ownership and the terminal fast path

Incoming stream handlers are registered centrally and receive a bind function
for the matched stream, an abort signal, and the same runtime identity. The
first handler that recognizes a pre-authorized stream ID owns it; unknown
streams are cancelled. Owner selection has the same bounded deadline as RPC,
so a stalled registry cannot retain an unowned stream indefinitely. Frames are
ordered per stream ID rather than through one global queue: a slow consumer
backpressures its own stream without blocking unrelated connection, importer,
or synchronization streams. Once a handler binds ownership, every local reject,
deadline, transport failure, peer close, or host shutdown reaches its `onClose`
cleanup boundary exactly once. The same abort signal remains live for the whole
owned stream and is aborted before cleanup, so long-running Provider work can
stop promptly instead of polling runtime state.
Handlers registered after activation require a restart, matching RPC route
snapshot semantics.

General RPC streams remain bounded control/data channels for importers, sync,
connection Providers, and non-hot terminal results. Phase 6 still creates its
planned direct terminal-worker-to-utility-process `MessagePort`; it must not put
the 4 ms interceptor budget through this general JSON-RPC path.

Every outbound write either reaches the transport or rejects. Port failure,
router close, peer cancellation, and local cancellation settle all queued
writes and invalidate retained receive-credit callbacks. If returning receive
credit itself fails, the incoming stream is removed and its owner is notified
before the error escapes. Normal end/error frames await the owner's asynchronous
close handler; forced synchronous router shutdown contains a rejected cleanup
promise so it cannot become an unhandled process rejection. Later provider code
must still release consumed chunks promptly and must not retain a release
callback as an application-level acknowledgement.
An outgoing stream that has sent its terminal `end` retains only its bounded
credit state until the peer releases the final chunks. Those ordinary late
window updates retire the stream instead of being misclassified as protocol
violations; writes remain closed as soon as `end` is sent.

## Placement, lifecycle, and packaged modules

Runtime placement is selected through an injectable resolver. The default
continues to prefer the sandboxed browser entrypoint. Phase 3 can require an
advanced-runtime grant, and phase 9 can add trust attestation, without changing
activation, crash, or shutdown ownership.

The resolver receives an abort signal. Stop, disable, uninstall, and application
shutdown cancel both a pending placement decision and an activation already in
progress. Cancellation does not count as a plugin crash. A permission prompt
introduced in phase 3 must honor this signal, so shutdown never waits for a
renderer decision and no runtime can appear after the supervisor has closed.
Manager shutdown starts supervisor cancellation before waiting for its serialized
mutation queue, so a mutation currently blocked inside placement or activation
cannot deadlock the quit path that is waiting for that same mutation.
Concurrent manager or supervisor shutdown callers share the same completion
promise. No caller may observe shutdown completion before runtime teardown and
startup cancellation have both settled.
Browser and utility runtimes recheck the same signal after every asynchronous
resource-creation boundary; cancelling only the outer supervisor promise is not
sufficient.
Start and stop also share a per-plugin transition gate. A lazy activation waits
for the previous process to finish stopping, while disable/uninstall persist the
disabled state before teardown. Later activation events therefore cannot race a
management operation and recreate a runtime that the user just disabled.
For an advanced utility runtime, `kill()` is only a termination request. Its
stop promise remains pending until Electron emits the child `exit` event.
Unexpected fatal and protocol failures likewise revoke RPC immediately but are
published to the supervisor only after the process is reaped. Permission,
connection, synchronization, and companion state can therefore treat the stop
event as a real process-containment boundary rather than an intent signal.
If the process ignores graceful termination, the host escalates to an OS-level
forced termination after a bounded grace period and still waits for `exit`.
Failure to reap after escalation disables and quarantines the plugin for the
rest of the application process; no replacement activation is allowed until
Netcatty restarts. This fail-closed state is deliberately in-memory as well as
persisted, so clearing a normal crash quarantine cannot overlap a still-live
advanced process.

Runtime state listeners receive starting, running, stopped, error, and
quarantined transitions with the stable activation identity. Permission scopes,
commands, views, and Provider registries can release their state on one common
stop boundary. Listener failures cannot break plugin shutdown.

Progress notifications have a separate supervisor event. Each event carries
the host-assigned activation identity together with the schema-validated token
and an immutable progress value, so simultaneous Providers from different
plugins or plugin versions cannot collide on a token alone.

Browser import maps and utility-process loader mappings are generated from one
reviewed host-module resource list. Adding `@netcatty/plugin-ui` or another
host-owned SDK package does not expand arbitrary filesystem access or require a
new protocol route. Plugin packages still cannot add mappings themselves.

## Downstream phase matrix

| Phase | Stable seam available to the phase | Work owned by that phase |
| --- | --- | --- |
| PR 3 permissions | RPC middleware, immutable runtime identity, raw-message guard, placement/principal resolver, runtime stop events | principal-bound grants, resource canonicalization, secrets, credentials, companions, quotas (implemented) |
| PR 4 contributions | host-to-plugin request/notify, runtime events, host module resources | implemented: lazy activation, command/settings/view registries, Context Keys, UI SDK and sandboxed views |
| PR 5 terminal Providers | validated host requests, cancellation, lifecycle events | Provider ranking, deadlines, snapshots, built-in highlighter/autocomplete adapters |
| PR 6 terminal pipeline | runtime identity and placement policy | direct MessagePort fast path, sensitive-input bypass, circuit breaker |
| PR 7 connection/auth/import | activation-owned Provider requests, exact result validators, bounded streams, diagnostics, secret leases, credential refs | implemented: connection sessions, authentication challenges, importer preview/commit |
| PR 8 sync | streams, lifecycle identity, namespaced storage boundary | implemented: `kind: "sync"` Providers with `provider.sync`, encrypted-object connect/read/write/delete/capabilities, WebDAV through shared storage surface, non-cascade sidecars for `sync: true` settings and account/CRDT baselines |
| PR 9 distribution | retained immutable versions, compare-and-set restore, placement resolver, module resources | signatures, trust, health checks, audited update and user rollback policy, API 1.0, and the reproducible terminal benchmark harness/environment/release gate for the 1% throughput and 4 ms p95 / 8 ms p99 input-latency targets |

## Data-model decisions that must remain explicit

The phase-2 database retains every installed immutable version and provides a
compare-and-set pointer restore used only when a just-installed version fails
activation. Phase 9 can build audited update, health-check, and user-initiated
rollback policy on this primitive without changing package layout; phase 2 does
not expose that broader policy.

Crash history is keyed by plugin and version. Changing the active version
starts with clean runtime state, while reinstalling identical version bytes
does not clear quarantine. Phase 9 can therefore assess and roll back one bad
release without inheriting or erasing another version's failure history.

Package publication exposes one internal `beforeActivate` commit boundary.
The manager uses it to disable and stop an enabled old activation before the
database pointer changes, and restores that activation if preparation fails.
Phase 9 health checks and rollback must preserve this ordering instead of
writing the active-version pointer directly.

`plugin_kv` is runtime-owned local data and is removed by explicit uninstall.
Phase-3 encrypted secrets, persistent grants and security audit, plus phase-4
settings and view state, use separate non-cascade tables. PR 8 stores encrypted
sync sidecars (`plugin_sync_sidecars`) in the same non-cascade class for
`sync: true` settings plus plugin sync account/CRDT baselines. Missing or
uninstalled plugin code must not cascade-delete those rows or coerce related
sync configuration away.

Activation events are declared by the public manifest. Phase 4 now starts only
`onStartupFinished` plugins during contribution initialization; commands, views,
and Providers call the existing idempotent `start()` boundary at first use.
This implements lazy activation without replacing process supervision.

## Review checklist for changes to this boundary

Before a later phase changes the supervisor or transport, verify:

1. Can the behavior be expressed as a registry handler, middleware, placement
   resolver, state listener, validated request, or stream owner instead?
2. Does every privileged operation retain the host-generated runtime identity?
3. Can a request race an update, disable, quarantine, crash, or shutdown and
   reach a stale runtime?
4. Are request and notification semantics distinct and exactly validated?
5. Is terminal hot-path work kept off general JSON-RPC?
6. Does missing or uninstalled plugin code preserve user-owned data?
7. Does adding a host SDK module expand only an explicit trusted resource list?

If the answer requires a new public plugin concept, update the canonical JSON
Schema, generated types, SDK, compatibility rules, documentation, and drift
tests together. An internal shortcut must not become an accidental public API.
