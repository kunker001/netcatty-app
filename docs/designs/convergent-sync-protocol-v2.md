# Convergent Sync Protocol and Migration

Status: experimental end-to-end implementation.

Issue: [#2245](https://github.com/binaricat/Netcatty/issues/2245)

## Compatibility contract

A v2 cloud file remains a normal `SyncedFile`. Its plaintext metadata adds only
`syncSchemaVersion: 2`; the complete materialized v1 `SyncPayload`, CRDT
metadata, conflicts, and candidate values remain inside the existing
AES-256-GCM ciphertext.

The decrypted payload keeps all v1 fields so an older Netcatty client can read
hosts, keys, snippets, settings, and other synchronized collections without a
new parser. The adjacent `convergentSync` envelope records causal metadata and
concurrent alternatives. For a visible entity field or settings leaf, the
selected winner is normally omitted from the envelope and reconstructed from
the materialized v1 field. Structural presence and position values stay inline;
they are CRDT metadata rather than duplicated user records.

Hydration fails closed when:

- plaintext metadata advertises an unknown or malformed schema;
- metadata and the encrypted envelope disagree;
- a materialized winner cannot be reconstructed;
- the envelope violates any core dot, context, origin, vector, or HLC
  invariant;
- an unknown collection would be discarded by the current materializer.

## Legacy import

Initial v1-only migration downloads every connected provider and runs the
existing smart merge against each provider-specific trusted base. A provider
without a trustworthy base may be adopted as a fresh-device seed, or accepted
when it exactly matches the current merge; divergent data without a base blocks
instead of guessing whether an absent entity was deleted. Any unresolved
entity/settings conflict, unavailable provider, or shrink guard blocks
initialization. A successful result becomes one v2 CRDT lineage and is written
back as a full v1 materialized snapshot plus the compact envelope.

If one or more providers already contain v2, their states are joined with the
CRDT join. A legacy local or provider snapshot may then contribute writes only
when a trusted materialized baseline is available. The baseline-to-snapshot
field diff is applied on an independent branch with a stable synthetic device
ID and then joined, so multiple legacy writers remain concurrent instead of
being ordered by provider iteration. Without a trustworthy baseline, upload is
blocked rather than guessing whether an absent field means deletion.

Optional top-level collections omitted by an old client, or present only as an
in-memory `undefined` property, are treated as unsupported and left unchanged.
Explicitly present empty collections are real deletions. Arrays inside settings
remain atomic, matching the CRDT core. Every legacy branch also passes the
suspicious-shrink guard before its writes can join an existing v2 state; fields
omitted by that client inherit the trusted baseline for this safety check.
A device with no cloud entities and no trusted local baseline is treated as a
fresh install: v1 and v2 migrations seed from cloud instead of turning local
first-launch settings into edits. With a trusted baseline, an empty local
snapshot remains a causal deletion. A v1 provider selected as the fresh-device
seed still passes the same suspicious-shrink guard before it can initialize v2.

## Local persistence and key rotation

The canonical replica and provider-specific v2 baselines are encrypted with the
same master-derived AES-GCM key used for existing sync bases and sync snapshots.
Loading an existing v2 record is strict: corruption and unsupported schemas are
errors, never `null` fallbacks.
Provider-specific v2 baselines are invalidated together with the existing merge
base and remote anchor whenever an account, endpoint, bucket, or connection is
replaced, so a new remote identity can never inherit trust from the old one.

Master-key rotation prepares replacement ciphertext for all derived-key sync
records before writing anything. It snapshots both existing records and absent
keys, then verifies neither changed during preparation. Only then does it commit
the new ciphertext and publish the new master configuration. A write failure
restores the exact prior ciphertext and configuration.

The experimental enabled/paused flag is device-local and is intentionally not
part of `SyncPayload.settings`. Disabling an initialized replica pauses it; it
does not delete local or cloud metadata. Clearing v2 storage requires explicit
downgrade confirmation.

## Backup and restore

Local vault backups remain materialized snapshots and never carry the active
replica. Migration initialization uses the existing protected-apply transaction:
under the convergent Web Lock it rebuilds the current cloud-sync payload and
compares it with the snapshot used for the preview. Any intervening local edit
aborts initialization and requires a new preview. An unchanged vault gets a
required encrypted safety backup, holds the cross-window restore barrier,
applies the previewed materialized payload, persists the canonical replica, and
only then marks v2 initialized. Before releasing the same Web Lock, migration
forces a convergent read/merge/write/verify cycle so unchanged v1 materialized
data still receives a v2 envelope on every connected provider. Concurrent
provider edits discovered by that cycle are protected and applied locally;
partial publication remains visible as a provider error and pending sync. The
sync manager must still be unlocked immediately before this transaction;
otherwise initialization fails before any backup, sentinel, or local mutation.
A crash or failure after mutation starts leaves the existing apply sentinel set
so auto-sync cannot publish a partial migration.

Before a local backup restore mutates local data, the restored snapshot is
diffed against the current materialized replica and prepared as normal device
writes without persisting them. The replica load is therefore validated before
the protective backup and partial-apply sentinel, while the prepared writes are
committed only after every local import step succeeds. A preparation failure
leaves no sentinel because the vault is still untouched. An import failure
leaves the replica unchanged; a later replica commit failure leaves the
protected-apply sentinel set so the partial restore cannot be published. Causal
history and tombstones survive restore instead of being replaced by an unrelated
replica copied from the backup.

Trusted legacy diffs also compare collection positions. A reorder-only edit is
converted into position-register writes for entity and string collections,
rather than disappearing because the values themselves are unchanged.
In-memory entities are normalized with the same JSON serialization semantics
as encrypted sync payloads before validation, so optional `undefined` model
fields are omitted instead of preventing migration.

## Provider convergence state machine

An initialized device holds one canonical replica shared by every provider.
Each sync acquires an exclusive Web Lock; environments without Web Locks fail
closed so two renderer windows cannot allocate and upload competing local
states. Disabling the experimental switch pauses the v2 path and never falls
through to the legacy writer.

The runtime downloads every connected provider before choosing an outgoing
state. `smartMerge` joins local writes and all remote branches, `preferLocal`
joins first and then creates causal local writes that dominate the joined
registers, and `preferCloud` adopts the unordered remote join. The canonical
state containing locally generated dots is encrypted and persisted before any
provider upload. Downloaded remote-only dots are committed to the local replica
only after at least one provider verifies the joined state; a total network
failure therefore leaves the durable replica aligned with the unchanged local
vault and safely retries the remote branch later.
Before `smartMerge` or `preferLocal` turns a local snapshot into writes, the
existing suspicious-shrink guard compares it with the materialized replica.
Mass deletion is blocked before dots are allocated or persisted unless the
user performs the existing one-shot force operation.

Providers then run at most three read-merge-write-verify rounds. Every round:

1. downloads and joins in memory any state that appeared since the initial read;
2. uploads the same expected vector to available providers;
3. reads each provider back and accepts the write only when the returned vector
   dominates the expected vector;
4. joins verified remote supersets and repeats when they contain new concurrent
   state.

The retry delay uses short full jitter. One unavailable provider remains an
error and leaves local sync pending, but it does not roll back providers that
verified successfully. Because locally generated causal writes are durable
before network I/O, application restart retries the same dots instead of
regenerating them. Provider baselines and the joined canonical replica advance
only after read-back verification.

## Conflict resolution and downgrade

Materialization exposes retained conflicts by register address. Choosing a
candidate writes a new device value whose context observes every candidate;
the resolution therefore dominates stale replicas and propagates through the
normal provider state machine. If propagation discovers additional concurrent
provider writes, Netcatty applies the final canonical materialization locally
before releasing the same Web Lock. Secret-bearing fields are detected from
their address and nested field names, including objects nested inside atomic
arrays. Their UI renders only “set” or “empty”; values are never formatted,
logged, or inserted into DOM text.

Explicit downgrade holds the same Web Lock and downloads every connected
provider before writing anything. Netcatty first converts edits made while v2
was paused into causal writes over the local replica, then joins those writes
with every remote state. It applies the joined payload behind a protective
backup and blocks downgrade until any newly discovered field conflicts are
resolved. It then writes the joined materialized v1 snapshot to every provider,
downloads it again, and verifies both the absence of v2 metadata and equality
of cloud data.
Only after every provider verifies does Netcatty clear the local replica,
provider baselines, and experimental configuration, still inside the same Web
Lock. A partial downgrade keeps the joined local v2 state and refreshed
provider baselines so the user can retry safely without losing remote-only
dots.
