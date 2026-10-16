# Plugin platform threat model

Status: phase 3 internal security boundary

Plugins are untrusted code. A useful plugin may parse terminal output, display
content, call remote services, or ship a native companion; none of those needs
imply trust in the author's code, update server, dependencies, or account.

This threat model records the security properties that the nine-stage platform
must preserve. Phase 1 enforces package-format properties and defines the wire
types. Phase 2 implements process isolation and lifecycle containment behind a
development gate. Phase 3 adds capability mediation, scoped grants, encrypted
secrets, companion containment and quotas; later phases add distribution trust.

## Protected assets

- passwords, private keys, API keys, OTP values, and secret-setting plaintext;
- terminal input while echo is disabled or authentication is in progress;
- host addresses, usernames, notes, command history, and terminal output;
- local files and filesystem metadata outside a plugin's data directory;
- Netcatty renderer and main-process authority, Electron IPC, and Node APIs;
- other plugins' packages, storage, logs, settings, and runtime messages;
- cloud synchronization keys and provider credentials;
- the integrity and availability of terminal sessions and the Netcatty process.

## Adversaries

The design assumes any of the following may be hostile:

- a locally installed plugin package;
- a plugin dependency compromised after publication;
- a publisher account or distribution server;
- a companion executable;
- remote content rendered or parsed by a plugin;
- a malformed or intentionally expensive RPC peer;
- an old package crafted to exploit a newer installer;
- an update that requests broader permissions than the installed version.

The operating system, Electron sandbox, Netcatty application package, and user
account are trusted. A machine already controlled by malware is outside the
platform's protection boundary.

## Package attacks

### Archive traversal and aliasing

ZIP entries can target an absolute path, contain `..`, use backslashes on
Windows, differ only by case, or exploit reserved device names. Extractors may
then write outside staging or overwrite a different entry.

The contract CLI accepts one normalized POSIX spelling for each path and
rejects exact, Unicode compatibility, and case-folded duplicates. The phase 2
installer must run the same validation before extraction and must extract only
under a newly created staging directory.

Every archive entry uses the ZIP UTF-8 flag. Validation compares the raw
central-directory name with the local-header name and also requires matching
flags, compression method, CRC, and sizes, preventing different ZIP readers
from validating and extracting different interpretations of one package.

Manifest decoding is fatal UTF-8 on both source directories and archives.
Malformed byte sequences cannot be normalized differently by separate package
inspection and installation paths.
The packer also binds the exact validated manifest bytes to the scanned package
entry with byte length and SHA-256, then rechecks the entry while writing. A
source manifest changed between semantic validation and archive creation is
rejected instead of inheriting the decision made for older bytes.
Every source hash read enforces the file budget incrementally, and the writer
refuses the first byte beyond the scanned size. Concurrent file growth therefore
fails before it can turn validation or packaging into unbounded disk I/O.
Installation retains the validated archive and binds it to both the archived
byte digest and a canonical logical-content digest. The runtime gate rescans the
installed directory immediately before placement and rejects changed, missing,
or injected files before plugin code starts. This is an integrity and recovery
boundary for corruption or unintended local modification; it is not a claim
that Netcatty can defend against an already-compromised same-user operating
system account.

### Symbolic links and executable smuggling

A symbolic link can make an apparently safe relative path resolve outside the
package. An executable bit can also hide an undeclared native program among
ordinary assets.

Packages cannot contain symbolic links. Executable files must appear in a
platform-specific `companionExecutables[].variants` entry; every variant binds
its package path, supported target platforms, and content SHA-256. A later
signature covers both the manifest and deterministic archive.

### Resource exhaustion

Small compressed inputs can expand into very large outputs, or contain huge
file counts and path names. Both source packing and archive validation impose
limits on archive bytes, expanded bytes, individual files, entry count,
manifest bytes, and path bytes. The installer must enforce limits while
streaming, before committing package metadata.

A byte limit alone does not bound parser work: a small manifest can contain
thousands of nested arrays or a very large number of tiny JSON values. Manifest
validation therefore applies explicit depth and node-count budgets before the
recursive JSON Schema validator runs. Exceeding either budget is an ordinary
package validation failure, not an uncaught stack overflow.

## Runtime attacks and capability controls

### Renderer escape

Normal plugins run in a sandboxed Chromium context without Node,
`contextIsolation` bypasses, arbitrary Electron IPC, or direct access to the
application React tree and xterm instance. Plugin documents use a dedicated
protocol with a restrictive Content Security Policy. The bootstrap removes
direct fetch, socket, WebRTC, transport and worker globals before importing
plugin code. Its isolated session is also offline behind an unreachable proxy,
with non-proxied WebRTC disabled, so a fresh iframe global cannot restore
network authority. Ordinary browser plugins access the network only through the
checked phase-3 host broker. An advanced utility plugin is an explicit high-risk
exception: `runtime.advanced` consents to ambient Node, filesystem and network
authority in a contained process. It never runs in the Netcatty main process,
and phase 9 must additionally require verified publisher trust.

### Confused deputy

A plugin may ask the host to act on another plugin, terminal, host, file, or
network origin. Every request must carry runtime identity assigned by the host;
the host must ignore plugin-supplied identity fields. Capability handlers check
the sender, active operation, declared permission, user grant, and resource
scope before using application authority.

### Permission laundering

A plugin could call a broadly capable built-in command or another plugin to
avoid its own permission check. Public commands therefore retain caller
identity, and capability checks occur at the final privileged boundary rather
than only in UI or command registration.

### Secret exfiltration

Secret values are never ordinary settings or JSON-RPC results. The credential
broker uses operation-bound, single-use leases. Terminal input that Netcatty
marks sensitive through host-owned state or recognized original-output
credential challenges bypasses third-party hooks unconditionally. Generic PTYs
do not expose a trustworthy live echo-mode signal, so an arbitrary custom or
promptless no-echo program cannot be identified in every protocol. The native
input-interception permission warning discloses this limit, and public use stays
restricted to explicitly approved signed advanced plugins in the final rollout
stage. Logs, diagnostics, synchronization, and crash reports redact secret
fields before persistence.
The SDK secret store returns an opaque `SecretRef`, never stored plaintext.
Netcatty-owned Vault material uses a distinct opaque `CredentialRef`; its
main-process resolver validates availability without materializing plaintext,
then resolves only while consuming an operation-bound lease. Neither reference
is treated as a bearer capability: every privileged use must revalidate the
calling plugin, resource ownership, permission, runtime, and operation.
Importer Providers receive an exact draft contract rather than arbitrary Vault
objects. Host drafts reject executable startup commands and hidden built-in
plaintext credential fields; imported sensitive material must appear only in
identity/key drafts and is redacted from the bounded safe preview before
persistence.

### Denial of service

RPC requests have deadlines and cancellation IDs. Streams have explicit byte
windows. The supervisor enforces activation and shutdown deadlines, bounded
pending work, bounded logs, crash quarantine, raw-message/capability/byte
quotas, and CPU/memory monitoring for runtimes and companions. Later terminal
phases add interceptor circuit breakers. A
failed plugin must not stop unrelated plugins or terminal sessions.

RPC control JSON is capped at 1 MiB. Stream frames use a separate 24 MiB JSON
budget only to carry a 16 MiB JSON/base64 chunk; transferred buffers are still
validated against the 16 MiB chunk limit. This keeps large data on the
credit-controlled path and prevents a single string from bypassing structural
depth and node limits.

Runtime decoders must apply exact schemas for reserved methods instead of
accepting malformed reserved messages as generic RPC. Transferable stream data
is brand-checked through the native `ArrayBuffer` internal slot; an object that
only spoofs `Symbol.toStringTag` or `byteLength` is not a transferable buffer.
JSON serialization reads validated own data properties directly and never
executes inherited `toJSON()` hooks supplied through a hostile prototype.
All RPC and stream JSON values use the same depth and node-count budgets, plus
their surface-specific byte budgets, so a validly framed peer cannot consume an
unbounded call stack, validation loop, or retained control-message allocation.
The stdio decoder also consumes fragmented byte queues by advancing an index
rather than repeatedly shifting arrays. Small fragments are copied into bounded
slabs, preventing both quadratic work and per-byte object retention when a peer
delivers a large frame in very small chunks. Copying also prevents a caller from
mutating queued Node.js `Buffer` storage after `push()` returns.

### Update substitution and rollback

The final distribution stage uses signed repository metadata, publisher
signatures, staged health checks, atomic version switching, and rollback to the
last healthy version. Permission, API, or trust-level increases require a new
user decision; an existing grant is not silently widened.

## Security invariants

The platform is not ready for public enablement unless all of these hold:

1. Ordinary plugins have no ambient Node, Electron, filesystem, network, React,
   or xterm authority.
2. A declaration is not a grant, and a grant is limited to its declared
   resource and lifetime.
3. No renderer means interactive permission requests fail closed.
4. Input marked sensitive by host-owned state or recognized credential-prompt
   detection never reaches plugin hooks. Generic input interception warns that
   arbitrary custom or promptless no-echo input cannot be detected reliably by
   a remote PTY, and remains unavailable to public plugins until the signed
   advanced-plugin rollout gate is enforced.
5. The package installed is the package validated and, later, signed.
6. A plugin cannot address another plugin's storage or runtime by changing an
   identifier in its request.
7. Plugin failure is contained and the terminal data path fails open only where
   disclosure is impossible.
8. Secrets never enter manifests, package defaults, logs, diagnostics, or cloud
   synchronization sidecars.
9. Unknown newer protocol versions fail closed at privileged boundaries.
10. Disabling every plugin restores the unextended Netcatty behavior and does
    not impose more than the agreed terminal throughput budget.

## Phase 1 baseline

The first phase did not load plugin code. It introduced the SDK interfaces,
committed Schema bundle, deterministic package format and package validation so
the runtime boundary could be reviewed separately. Phase 2 now consumes those
artifacts without changing the public contract version.

## Phase 2 runtime boundary

Phase 2 implements package installation, isolated browser and utility-process
runtimes, bounded RPC/streams, lifecycle deadlines and crash quarantine. These
paths remain disabled unless `NETCATTY_PLUGIN_DEV=1` is set. The browser path
has no ambient Node, Electron, filesystem or network authority. The Node path is
explicitly an advanced runtime and remains behind the development gate until
phase 9 adds signed trust policy.

## Phase 3 capability boundary

Phase 3 installs the permission engine at the final host RPC boundary. A
declaration is never a grant. `once`, host-session, application, and persistent
grants share canonical resource-coverage rules and are bound to a declaration
hash plus a host-resolved security principal. The current unsigned principal is
derived from plugin ID, publisher, and immutable package SHA-256; phase 9 can replace it with a verified
publisher-key identity through the placement resolver without changing grant
semantics. A new principal or changed required/resource declaration requires a
new decision.

Network access is origin-scoped, cookie-free and redirect-by-redirect. File
access authorizes a lexically resolved absolute request without probing the filesystem,
then resolves it after permission and requires the caller to have supplied that
canonical real path. Opened reads are bound to the authorized pre-open inode and
the current path inode. Arbitrary-path creation is denied until a portable
opened-parent implementation exists; overwriting an existing regular file
remains available without exposing a parent-symlink creation race.
Companion executables are package-contained, digest-verified immediately before
shell-free spawn, host-RPC clients only, and their complete process group/tree
must be reaped before their handle is released. Failure to contain a companion
disables its plugin, persists the containment error, and prevents package
mutation or replacement activation until containment is restored.

Secret plaintext is encrypted by Electron `safeStorage` and never returned by
ordinary secret RPC. A credential consumer must redeem a one-use lease bound to
plugin, runtime, operation, abort signal and a maximum 60-second lifetime.
Transport, capability, log, byte, process-count, pending-call, memory and CPU
quotas contain abusive runtimes and companions. The capability boundary remains
disabled unless `NETCATTY_PLUGIN_DEV=1` is set. The first-party development path
injects a native Electron decision provider; any host without a decision
provider fails interactive permission requests closed. Runtime CPU/memory
monitoring begins at process creation rather than after plugin activation, and
native prompt text escapes control and bidirectional formatting characters.
