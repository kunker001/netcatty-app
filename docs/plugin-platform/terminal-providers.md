# Terminal Provider API

PR 5 adds the host-owned terminal Provider registry on top of the isolated
runtime and permission boundary. Provider declarations remain immutable
manifest data. Listing Providers never starts a plugin; first invocation uses
the existing idempotent `onProvider:<id>` activation seam and revalidates the
active plugin version and runtime identity after the response.

## Runtime registration

An activated plugin registers only contributions owned by its exact plugin ID:

```ts
context.subscriptions.add(context.providers.register(
  "com.example.shell.completion",
  "terminal.completion",
  async ({ payload, cancellationToken }) => {
    if (cancellationToken.isCancellationRequested) return { items: [] };
    return { items: [{ text: "git status", displayText: "git status", score: 100 }] };
  },
));
```

Registration is activation-owned and disposable. A stale disposable cannot
remove a replacement registration. Invocation carries the declared Provider
ID/kind, an operation, a host-generated request ID, a bounded JSON payload, the
deadline, and a cooperative cancellation token. Results use the canonical
`ok`/`cancelled`/`failed` Provider result union and are validated again by the
main process before renderer use.

Each invocation reauthorizes the Provider kind's least-privilege permission
set against the current runtime identity before sending a session snapshot or
request payload. Required grants are reused; optional declarations prompt at
first use and denial/cancellation returns no terminal data to the runtime.

## Terminal snapshots and lifecycle

Providers receive immutable metadata snapshots containing only stable session
identity and presentation context: session/host/workspace IDs, protocol,
connection status, cwd, title, shell type, dimensions, and alternate-screen
state. Active runtimes can subscribe with `context.terminals.onDidChange()`.
Protocol values preserve the actual built-in transport (`ssh`, `mosh`, `et`,
`telnet`, `local`, or `serial`) and accept bounded namespaced identifiers for
future connection Providers instead of collapsing non-SSH transports to SSH.
Immediately before an invocation, a lazily activated Provider receives a
`snapshot` event for the current session so it does not depend on lifecycle
events that occurred before activation.
Lifecycle events cover creation, connection/reconnection, cwd/title/resize/
alternate-screen changes, command submission, host-detected command completion,
disconnect, and disposal. Completion events contain no command text or raw
output and are emitted from OSC 133 completion markers when available, with a
conservative next-prompt fallback for shells without integration markers.
Connection-scoped cwd, title, and alternate-screen metadata is cleared before
disconnect and reconnect publication; viewport dimensions remain available.
Ongoing lifecycle delivery begins only after a successful invocation with a
non-`once` `provider.terminal` grant. Each event rechecks that grant without
opening a new prompt and remains bound to the exact plugin version, runtime ID,
runtime kind, and security principal that received the authorized invocation.
One-use grants receive only the invocation snapshot and payload.

PR 5 intentionally omits command text, password/prompt content, raw terminal
output, xterm objects, backend handles, and terminal-worker ports. The ordinary
JSON-RPC Provider path is not suitable for hot interception. PR 6 owns the
separate permission-gated MessagePort fast path for input/output interceptors,
sensitive-input bypass, circuit breaking, and the 4 ms interceptor budget.

## Privileged terminal data pipeline

PR 6 implements the two declared raw kinds without exposing xterm, Electron
IPC, backend streams, or the general plugin control plane. Only an advanced
utility runtime with `provider.terminal` and the matching
`terminal.intercept.input` or `terminal.intercept.output` grant can be attached.
Authorization is bound to the exact plugin version, runtime ID, runtime kind,
security principal, terminal session, direction, and declared Provider.
Because the transferred port is a long-lived capability, both permissions must
resolve to a session, application, or persistent grant; a one-use grant is
rejected before either port endpoint is published.
Browser runtimes are rejected before a port is transferred. Publisher
signature eligibility remains a distribution-policy decision owned by PR 9;
the advanced runtime and explicit high-risk permission boundary is already
enforced here.

An activated utility plugin uses the same registration owner and receives a
specialized SDK invocation:

```ts
context.subscriptions.add(context.providers.register(
  "com.example.filter.input",
  "terminal.interceptor.input",
  async ({ data, session, sequence }) => {
    // The transferred UTF-8 Uint8Array is owned by this invocation.
    return data;
  },
));
```

For each terminal session, Netcatty permits at most one arbitrary interceptor
per direction. A single candidate can be selected automatically; competing
candidates require an explicit host-owned user choice and "No interceptor" is
the default/cancel action. The choice is session-local and is discarded on
session disposal, contribution withdrawal, runtime replacement, crash, or
quarantine. The requesting renderer must own the terminal session before any
authorization or activation work occurs.

The main process transfers the two ends of one `MessageChannelMain` directly
to the terminal worker and selected plugin utility process. The utility-side
attachment is established by a transfer-aware `PluginRpcRouter` request, so
the existing router owns correlation, deadline, cancellation, validation,
late-response retirement, close cleanup, and protocol-failure containment.
Only the accepted long-lived byte path leaves the control plane. Data messages
contain a monotonic sequence, direction, bounded credit information, and one
transferable `ArrayBuffer`; the main process never copies terminal payloads.
Ready, chunk, successful-result, and failed-result metadata use the canonical
`TerminalInterceptorFrame` union. Both worker and utility peers validate it
from the generated contract bundle, and the shared MessagePort envelope rejects
missing, unexpected, detached, oversized, or byte-length-mismatched transfers.
The worker serializes chunks, caps each transfer at 64 KiB, and limits queued
output to a 256 KiB credit window. Output remains ordered and host output taps
retain the original data. Renderer flow acknowledgements use the original
ingress count even when a plugin expands, contracts, or completely suppresses
visible output. Host-bypassed sensitive input and protocol replies still wait
behind earlier ordinary input so bypass cannot reorder the terminal stream.

Input requests have a 4 ms worker-owned deadline. Output requests have a
bounded 50 ms deadline and a 256 KiB queued-output window. A timeout, malformed
response, invalid UTF-8 result, closed port, runtime exit, or credit-window
overflow trips the circuit breaker immediately: the original chunk fails open,
the interceptor is disabled for that session/direction, and Netcatty displays
a host-owned warning. An interceptor cannot suppress that warning or re-enable
itself without a fresh host authorization path.

These budgets are containment limits, not production performance acceptance
evidence. PR 9 owns the reproducible benchmark harness, supported hardware and
operating-system matrix, and release gate proving no more than 1% no-plugin
throughput regression plus approximately 4 ms p95 / 8 ms p99 added input
latency before the development gate can be removed.

Credential protection is outside plugin control. Input that the host marks as
sensitive/no-echo bypasses the port before buffer creation, including every
character entered while the password-prompt state is active and confirmed
sudo/su credential autofill. Recorded automation credentials use a password
dialog, remain redacted from script activity/logs, and carry the same sensitive
marker through the script bridge. The terminal worker also recognizes authentication
challenges from bounded original-output tails before output interception, so an
output plugin cannot expose a password by hiding or rewriting its prompt.
Generic PTY protocols do not expose an authoritative live echo-mode signal.
Consequently, a custom or promptless program that disables echo may not be
recognized by the host classifier. The native permission dialog states this
limit before granting input interception, and public enablement remains blocked
until PR 9 restricts the capability to explicitly approved signed advanced
plugins. This is a deliberate limitation of the first terminal data path, not
an absolute no-echo confidentiality guarantee.
Sensitive input is also excluded from terminal broadcast. Terminal protocol replies, urgent interrupts, transfer input gates,
transport encoding, Telnet IAC escaping, host logs, renderer flow accounting,
and marker/safety parsing remain host-owned. Output interceptors may create or
suppress visible byte sequences that affect output-derived lifecycle signals
such as OSC 133. Netcatty owns the parser, marker objects, validation, and
cleanup, but deliberately derives those signals from the transformed visible
stream; credential-prompt classification remains based on bounded original
host output before interception. With no active interceptor, the
worker uses the existing synchronous output path and performs no interceptor
Promise, transfer, or payload allocation.

## Host adapters

Netcatty's built-in autocomplete engine and keyword highlighter use the same
application Provider adapters as plugins:

- completion requests run built-in and plugin Providers concurrently;
- one active request exists per session and Provider kind; a newer request
  cancels and suppresses the older result;
- Provider ordering is deterministic and can honor a host-owned preference
  list; completion items are score-ranked and text-deduplicated;
- one Provider failure is contained and does not suppress other Providers;
- plugin completion responses are capped and normalized before rendering;
- completion insertion/display text rejects control and bidirectional override
  characters before it can reach terminal input or suggestion UI. The host
  always renders the exact insertion text for third-party completions, so a
  friendly label cannot conceal a different command on previewless terminals;
- decoration Providers return declarative rules only. Rule IDs are namespaced,
  counts and strings are bounded, colors must be explicit hex values, and
  unsupported expressions are rejected before reaching the highlighter, and
  accepted plugin patterns are compiled and executed by the linear-time RE2JS
  engine with global, case-insensitive matching;
- decoration results are capped again after Provider fan-out at 16 active
  rules and 32 total patterns. Plugin matching examines at most the first 4096
  characters of each incoming text segment and retains at most 256 plugin
  matches per terminal write. Highlight colors are applied to already-parsed
  cells; ordinary input and output only rematch dirty rows. When rules change,
  the host restores original cell colors and recolors the visible viewport
  immediately, then finishes scrollback in idle slices. Heavy output may skip
  matching until one quiet-window catch-up. Patterns that can match an empty
  string are rejected because they cannot produce a visible highlight. Normal
  boot and hibernate wake share the same CWD-triggered decoration refresh path;
- link and hover Providers receive one bounded physical xterm line and return
  exact zero-based ranges. Links are restricted to credential-free HTTP(S)
  URLs, reuse the host link-modifier policy, and render hover text with host
  DOM nodes rather than plugin HTML. UTF-16 result boundaries are mapped back
  to xterm cells so wide and combining characters cannot shift activation or
  decoration ranges. Requests pause while the terminal is hidden or
  disconnected, and in-flight results are aborted and invalidated on either
  transition;
- matcher Providers receive at most the latest 32 parsed logical normal-buffer
  lines in one batch. Wrapped physical rows are joined before invocation and
  exact logical ranges are split back across host-owned xterm decorations.
  Each result identifies a host-provided `lineId`; ranges are validated against
  that exact line, the combined request text is capped below the 128 KiB
  Provider envelope, and at most 64 logical matches remain visible.
  Alternate-screen output is excluded;
- semantic Providers receive only a bounded command submitted from a
  positively confirmed shell prompt (or an explicitly identified network
  device prompt) and require `terminal.input`. Authentication challenges,
  REPL input, and other untrusted prompt-shaped input never reach ordinary
  Providers. Prompt Providers receive no command or raw output. Their
  bounded annotations are rendered at host-detected command completion. A
  prompt line is included only when the shared host detector confirms an empty
  shell prompt, so the last output line is never mislabeled as prompt context;
- background Providers return at most four solid-color presentation layers.
  Per-layer opacity and the combined host overlay are capped at 0.35, plugin
  HTML/CSS/images are never accepted, and the request includes the current
  terminal background color for contrast-aware results. An omitted layer
  opacity uses the host-owned safe default of 0.15. Providers may request
  a 250-60000 ms host refresh cadence; refresh pauses while the terminal is
  hidden or disconnected and is disabled when reduced motion is requested;
- theme Providers receive the complete current host palette and may return a
  bounded partial palette of explicit colors. Providers are merged in the same
  deterministic preference order as enumeration, with the first value for each
  color winning; host colors remain authoritative for omitted values;
- every ordinary visual adapter applies a renderer-owned end-to-end wait bound
  around lazy activation, authorization, and runtime work. Stale generations,
  disconnects, contribution changes, runtime replacement, and terminal
  disposal cannot reapply old visual results. Provider availability is cached
  from immutable enumeration without activation, stale enumeration generations
  cannot overwrite newer contribution state, and enumeration errors fail
  closed. Autocomplete, decoration, link, hover, matcher, and background paths
  therefore perform no plugin RPC work when those contribution kinds are
  absent or the development-gated host is disabled.

The operation payload/result shapes for the ordinary adapters are intentionally
declarative. Every payload also contains the immutable `session` snapshot for
the exact invocation:

- `terminal.completion/provideCompletions`: bounded input, cursor, host OS,
  CWD source, and result limit -> bounded completion items;
- `terminal.decoration/provideDecorations`: a host refresh reason -> bounded
  declarative highlight rules;
- `terminal.link/provideLinks`: `{ line, bufferLineNumber }` ->
  `{ links: [{ start, length, uri, label? }] }`;
- `terminal.hover/provideHovers`: `{ line, bufferLineNumber }` ->
  `{ hovers: [{ start, length, contents }] }`;
- `terminal.matcher/provideMatches`: `{ lines: [{ lineId, line,
  bufferLineNumber }] }` -> `{ matches: [{ lineId, start, length, label,
  severity?, color? }] }`;
- `terminal.semantic/provideSemantics`: `{ command }` -> classification,
  destructive/idempotent flags, and bounded annotations;
- `terminal.prompt/provideAnnotations`: a host reason -> bounded annotations;
- `terminal.background/provideBackgrounds`: a host reason and optional current
  terminal background -> bounded solid-color layers plus optional
  `refreshAfterMs`.
- `terminal.theme/provideTheme`: a host reason and complete current host palette
  -> a validated partial terminal palette.

The SDK exports and infers the matching payload, item, operation, and result
interfaces for all nine ordinary Provider kinds, including the immutable
host session snapshot attached to every invocation. The generic registration
overload remains available for later Provider kinds, so plugins do not need
application-internal renderer types and PRs 6-9 can add their own typed maps.

The control-plane JSON budget remains 1 MiB, while each terminal Provider
payload and result is additionally limited to 128 KiB. Default terminal
Provider requests have a 1.5 second deadline; autocomplete uses a shorter 750
ms runtime deadline plus an 800 ms renderer-owned end-to-end wait bound that
also covers lazy activation and first-use authorization. Built-in suggestions
therefore remain available when a plugin prompt is unanswered. Renderer
request cancellation is owned by the requesting
WebContents and all outstanding work is aborted when that sender is destroyed.
A single renderer may retain at most 64 active terminal requests, and one
fan-out invokes at most the first 32 deterministically ranked Providers.

## Downstream compatibility

The registry uses the existing generic Provider request/result envelopes,
runtime identity, cancellation, progress, permission names, and stream
protocol. PR 6 added its direct interceptor transport without changing the
ordinary registry. PR 7 reused that registration and runtime lifecycle for
connection, authentication, and importer Providers, with operation-specific
result validators and bounded stream consumers. PR 8 sync Providers (implemented)
and PR 9
rollout can reuse the same boundaries.
