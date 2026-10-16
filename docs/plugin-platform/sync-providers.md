# Sync providers

Netcatty cloud sync providers are dynamic and namespaced. Built-in providers
(`github`, `google`, `onedrive`, `webdav`, `s3`) stay compatible; plugins
register additional IDs under their plugin namespace with `kind: "sync"` and
permission `provider.sync`.

## Boundary

Plugins implement **encrypted object storage only**:

- `connect` / `disconnect` / `getAccount`
- `getCapabilities` (`revisions`, `conditionalWrites`, `atomicReplacement`, size limits)
- `readObject` / `writeObject` / `deleteObject`

Netcatty owns encryption, the master key, CRDT merge, migrations, protection
snapshots, conflict handling, and read-merge-write-verify. Plugin providers
never receive the vault master key or plaintext sync payloads.

## Secrets

Only non-secret configuration marked for sync enters cloud payloads. Plugin
connect secrets (`password`, `token`, `secret`, `apiKey`, `accessToken`) are
stripped from configuration, stored in the OS-backed plugin secret store, and
passed to `SyncConnectPayload.credential` as opaque `{ kind: "secret", id, key }`
references. Additional extracted secrets are stored under `sync-credential:<field>`
keys so plugins can `secrets.get` / `credentials.createLease` them.

Durable reconnects persist an opaque SecretRef (`{ kind, id, key }`), not
plaintext. The host injects Authorization only after consuming an
operation-bound lease whose `operationId` matches `network:<origin>`.

**Using a SecretRef from a sandbox plugin:** create an operation-bound lease via
`credentials.createLease` with `operationId` set to `network:<origin>` (same
origin the request will call), then call `network.request` with:

```json
{
  "url": "https://example.com/…",
  "credentialLease": { "kind": "secret-lease", "id": "…", "operationId": "network:https://example.com", "expiresAt": 0 },
  "authorization": { "scheme": "Bearer" }
}
```

The host consumes the lease (bound to the request origin, not a plugin-echoed
id) and injects `Authorization` (Bearer or Basic). Plaintext never returns to
the plugin. Companion `credentialLeases` remains available for node-only
companions.

WebDAV continues to exercise the shared EncryptedObjectStorage path for
configuration, proxy behavior, upload/download, and recovery. Write verification
on WebDAV is performed by the adapter's pad+verify upload (not a second host
byte re-read). Credentials remain field-encrypted at rest via the secure field
adapter.

## Streams and SyncLimits

Public `SyncLimits` (see plugin contract) define:

- `maxObjectBytes` — hard ciphertext cap
- `inlineObjectBytes` — maximum size that may travel inline on the control plane
- key / revision length bounds

Above `inlineObjectBytes`, main↔plugin uses credit-window streams
(`STREAM_WINDOW_BYTES` = 256 KiB). Renderer↔main uses structured-clone
`Uint8Array` for inline payloads and pull/chunked IPC (`sync-write-begin` /
`sync-write-chunk` / `sync-write-commit`, `sync-read-chunk`) for larger objects.
Transfers are per-sender, TTL-bounded, capped, and cancelled via
`cancelPluginExtensionRequest(requestId)` / `AbortSignal`.

## Sidecars (non-cascade)

Missing or disabled plugins must not delete synced settings or connection
baselines. Host-owned `plugin_sync_sidecars` carry `sync:true` non-secret
settings and account/CRDT baselines through collect/apply with last-known and
prefer-cloud merge semantics. Device-local baselines survive remote settings
wipes; empty-vault upload guards ignore last-known-only evidence.

## WebDAV

The production WebDAV adapter is wrapped as EncryptedObjectStorage so it shares
the same encrypt→write / read→decrypt surface as plugin providers. WebDAV's
native pad+verify upload already satisfies write verification and may leave
trailing padding on the remote object; the shared bridge therefore skips a
full byte re-read on that path (`assumeVerifiedWrites`) — without that flag the
host compare would false-fail on padded bodies. Plugin providers keep
host-owned byte compare after write.
