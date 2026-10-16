# PR #2452: SFTP Transfer Architecture Comparison

Research date: 2026-07-25

Source revisions:

- Netcatty current working branch: latest PR #2468 head
- Netcatty PR #2452 merge revision: `ad2730113c7a2c20a37bef4369d7a2b40bd2f060`
- Tabby: `14e2d60b9b6dee84a53c37f05eefeb803787de04`
- Electerm: `e68e61e3d0a8b2f66840282a4fc3dc7c40798699`
- OpenSSH portable: `7e446d3f5917c2f2770981a89d0e54d5d064bf0c`
- WinSCP: `b9307ef5f866a14dded9a330d8a2b8848d16dc7f`
- ssh2: `318d447ce3aca26e1ac73b63767b82a29b02467b`
- ssh2-sftp-client: `c690045a5d05e40f86db6b7321c6e627071b6c4a`

## Conclusion

[PR #2452](https://github.com/binaricat/Netcatty/pull/2452) directly addressed the measured upload throughput bottleneck. The old 8 x 32 KiB window allowed only about 256 KiB in flight. Raising it to 32 x 32 KiB allows about 1 MiB in flight while retaining Netcatty's proven safe chunk size. This follows the same direction as the 64 x 32 KiB defaults in ssh2 and OpenSSH and WinSCP's default queue of 64 upload requests, but remains more conservative.

The eventual change became much larger than a parameter adjustment because the old code did not have one reliable set of upload rules. Higher concurrency exposed races in cancellation, fallback, source-file changes, temporary-file cleanup, destination replacement, symlink handling, and permission restoration.

This follow-up PR has now merged the two high-level flows. Legacy upload, legacy download, and in-memory upload entry points only translate arguments and delegate to the transfer engine. Normal uploads, resumable uploads, and server-to-server uploads also use one remote upload transaction. Destination inspection, staging, replacement, backup restoration, permission restoration, pre-commit cancellation checks, and recovery evidence now have one implementation.

Different data-moving mechanisms remain at the lower layer, including local fast upload, resumable range upload, and SCP. These are required protocol adapters; they no longer define separate rules for publishing the final file. The largest remaining gaps are resume identity after an abnormal process exit and the still oversized transfer module.

## Scope of this follow-up PR

This follow-up PR includes the six commits omitted when the original PR was merged and this research document. Those changes cover the final pre-replacement race check, range-by-range source validation, cancellation and failure cleanup, servers without `lstat`, temporary-space preflight, and their tests. Later review also led to merging the two high-level transfer flows so the same failures no longer need separate fixes in two places.

The following work should remain separate: resume identity after an abnormal exit, adaptive request windows, a server-capability matrix, a more complete metadata contract, and further splitting the transfer module by responsibility.

## Comparison table

| Implementation | Single-file transfer path | Default request window / chunk | Resume and cancel | Final-path safety | Integrity and metadata |
|---|---|---:|---|---|---|
| Netcatty current branch | Concurrent fixed-offset reads and writes; prefers an isolated channel and then tries a shared channel | Upload 32 x 32 KiB; download 64 x 32 KiB ([configuration](https://github.com/binaricat/Netcatty/blob/e1793e382bf022f792a74cfca4d7de95c92bd5bf/electron/bridges/transferLimits.cjs#L3-L23)) | Only the highest contiguous completed range becomes a checkpoint; pause drains in-flight requests; cancel closes temporary channels | All upload entry points share destination inspection, staging, replacement, backup recovery, and symlink rules; download entry points share the transfer engine's local staging and publication flow | Local uploads share source-change and remote-size checks; resumable upload adds per-chunk SHA-256 validation; replacements restore the prior mode |
| Tabby | Serial application-level chunk reads and writes; no visible per-file request concurrency ([upload loop](https://github.com/Eugeny/tabby/blob/14e2d60b9b6dee84a53c37f05eefeb803787de04/tabby-ssh/src/session/sftp.ts#L113-L153)) | Application layer: 1 x 256 KiB | Cancel closes the file; no pause or fixed-offset resume ([transfer interface](https://github.com/Eugeny/tabby/blob/14e2d60b9b6dee84a53c37f05eefeb803787de04/tabby-core/src/api/platform.ts#L23-L55)) | Upload uses `.tabby-upload`, but removes the old file before rename; download writes directly to the final path | Checks the source only at start; no final digest or source recheck; the upload coordinator does not restore permissions |
| Electerm | Custom concurrent fixed-offset transfer shared by upload and download | 64 x 32 KiB ([defaults](https://github.com/electerm/electerm/blob/e68e61e3d0a8b2f66840282a4fc3dc7c40798699/src/app/server/transfer.js#L12-L40)) | Pause only stops dispatching new work; cancel waits briefly before closing the handle; no durable checkpoint | Main path overwrites the final file directly | Checks the source once and compares only byte count at the end; permission errors are not propagated |
| OpenSSH sftp | Pipelined read and write request queues | 64 x 32 KiB by default; server limits may reduce the chunk ([defaults](https://github.com/openssh/openssh-portable/blob/7e446d3f5917c2f2770981a89d0e54d5d064bf0c/sftp-client.c#L59-L63), [negotiation](https://github.com/openssh/openssh-portable/blob/7e446d3f5917c2f2770981a89d0e54d5d064bf0c/sftp-client.c#L552-L578)) | Supports `reget` and `reput`; interruption stops new requests and drains in-flight requests | Usually operates in place and does not promise transactional replacement | Resume assumes the existing prefix matches; the manual warns that a mismatch can corrupt the file ([manual](https://github.com/openssh/openssh-portable/blob/7e446d3f5917c2f2770981a89d0e54d5d064bf0c/sftp.1#L657-L672)); can preserve mode/time and request durable sync |
| WinSCP | Asynchronous upload and download queues with adjustable chunks | Upload queue 64, download queue 32 ([defaults](https://github.com/winscp/winscp/blob/b9307ef5f866a14dded9a330d8a2b8848d16dc7f/source/core/SessionData.cpp#L296-L305)); minimum 32 KiB, constrained by transport and server packet limits ([calculation](https://github.com/winscp/winscp/blob/b9307ef5f866a14dded9a330d8a2b8848d16dc7f/source/core/SftpFileSystem.cpp#L2243-L2321)) | Smart resume is enabled by default above 100 KiB, uses `.filepart`, and resumes by offset | Known or suspected symlinks and files owned by another user do not use resumable replacement; final replacement happens only after completion | Preserves existing or requested modes and times; permission failures have explicit handling |
| ssh2 | `fastGet` and `fastPut` share `fastXfer` | Configurable, default 64 x 32 KiB ([implementation](https://github.com/mscdex/ssh2/blob/318d447ce3aca26e1ac73b63767b82a29b02467b/lib/protocol/SFTP.js#L2185-L2226)) | Closes source and destination handles on callback or error; no resumable transaction | Opens the destination for overwrite; callers own staging and rename | Does not record a source snapshot or digest; callers own validation |

## 1. Request windows, chunk sizes, and transfer paths

### Netcatty

Netcatty deliberately fixes chunks at 32 KiB and configures separate upload and download concurrency: 32 upload requests, about 1 MiB in flight, and 64 download requests, about 2 MiB in flight. This is a product compatibility choice, not a protocol constant ([source](https://github.com/binaricat/Netcatty/blob/e1793e382bf022f792a74cfca4d7de95c92bd5bf/electron/bridges/transferLimits.cjs#L3-L23)). Resumable upload first tries fixed-offset concurrent writes on an isolated SFTP channel, then tries a compatible pipelined strategy. It does not silently fall back to serial streaming ([strategy](https://github.com/binaricat/Netcatty/blob/e1793e382bf022f792a74cfca4d7de95c92bd5bf/electron/bridges/transferBridge.cjs#L757-L1007)).

This design captures the most important practice used by mature clients: keeping several requests outstanding. It does not yet have their adaptive behavior. OpenSSH reads `limits@openssh.com` before choosing lengths, and WinSCP also reduces chunks according to transport and server limits. Netcatty once caused real corruption by increasing chunks, so it uses 32 KiB for every host. That conservative choice is reasonable. Future adaptation should rely on explicit allowance, measured behavior, and negotiation rather than a global chunk increase.

### Tabby and Electerm

Tabby's own SFTP coordinator is not a high-throughput reference. It waits for each 256 KiB read or write. Multi-selection upload uses an unbounded `Promise.all`, while recursive directory upload is serial ([single-file loop](https://github.com/Eugeny/tabby/blob/14e2d60b9b6dee84a53c37f05eefeb803787de04/tabby-ssh/src/session/sftp.ts#L113-L153), [multi-file scheduling](https://github.com/Eugeny/tabby/blob/14e2d60b9b6dee84a53c37f05eefeb803787de04/tabby-ssh/src/components/sftpPanel.component.ts#L210-L233)). The russh dependency may buffer protocol packets internally, but Tabby neither configures nor exposes that window, so its application code cannot establish a fixed protocol-level concurrency value.

Electerm is the closest comparison for PR #2452. Its `fastXfer` schedules 64 concurrent 32 KiB operations by default and uses fixed offsets for upload and download ([initialization](https://github.com/electerm/electerm/blob/e68e61e3d0a8b2f66840282a4fc3dc7c40798699/src/app/server/transfer.js#L12-L40), [scheduler](https://github.com/electerm/electerm/blob/e68e61e3d0a8b2f66840282a4fc3dc7c40798699/src/app/server/transfer.js#L289-L370)). Netcatty's 32-request upload window is more conservative but belongs to the same throughput class.

### OpenSSH, WinSCP, and the Node ecosystem

OpenSSH and ssh2 both default to 64 x 32 KiB. OpenSSH gradually grows the effective download window to its configured limit and tracks out-of-order responses ([download loop](https://github.com/openssh/openssh-portable/blob/7e446d3f5917c2f2770981a89d0e54d5d064bf0c/sftp-client.c#L1677-L1802)). Upload keeps outstanding requests below the limit as acknowledgements arrive ([upload loop](https://github.com/openssh/openssh-portable/blob/7e446d3f5917c2f2770981a89d0e54d5d064bf0c/sftp-client.c#L2111-L2198)). ssh2's `fastXfer` allocates `chunk size x concurrency` buffering and opens the destination for overwrite, so it is a fast-transfer primitive rather than a safe replacement transaction ([source](https://github.com/mscdex/ssh2/blob/318d447ce3aca26e1ac73b63767b82a29b02467b/lib/protocol/SFTP.js#L2185-L2285)).

`ssh2-sftp-client` only wraps ssh2's fast path. Its official documentation warns that concurrent fast transfer depends on server support and recommends ordinary `get` and `put` for broad compatibility ([documentation](https://github.com/theophilusx/ssh2-sftp-client/blob/c690045a5d05e40f86db6b7321c6e627071b6c4a/README.md#L1160-L1163)). This supports recording failure reasons and building a server compatibility matrix. It does not support silently switching to serial transfer and turning a performance feature into a completely different experience.

## 2. Resume, cancellation, temporary files, and atomic replacement

OpenSSH resume is simple: continue at the destination's current size and assume the existing prefix matches the source. On interruption it stops dispatching, drains outstanding responses, and tries to truncate to the highest contiguous confirmed position ([upload resume](https://github.com/openssh/openssh-portable/blob/7e446d3f5917c2f2770981a89d0e54d5d064bf0c/sftp-client.c#L2116-L2239), [download resume](https://github.com/openssh/openssh-portable/blob/7e446d3f5917c2f2770981a89d0e54d5d064bf0c/sftp-client.c#L1812-L1845)). Its interruption handling is reliable for an in-place command-line tool, but it does not promise atomic replacement.

WinSCP is the stronger product-level reference. Eligible uploads first use `final.filepart`, resume from that temporary file's size, and replace the final path only after completion. It disables resumable replacement when the target is a symlink or when delete-and-recreate would change ownership ([upload decision](https://github.com/winscp/winscp/blob/b9307ef5f866a14dded9a330d8a2b8848d16dc7f/source/core/SftpFileSystem.cpp#L4630-L4771)). Downloads also use local temporary files and resume offsets ([download staging](https://github.com/winscp/winscp/blob/b9307ef5f866a14dded9a330d8a2b8848d16dc7f/source/core/SftpFileSystem.cpp#L5420-L5489)).

Tabby uploads to `.tabby-upload`, but deletes the old destination before rename. A failed rename has no backup to restore. Downloads open the final local path directly ([upload](https://github.com/Eugeny/tabby/blob/14e2d60b9b6dee84a53c37f05eefeb803787de04/tabby-ssh/src/session/sftp.ts#L113-L153), [local download handle](https://github.com/Eugeny/tabby/blob/14e2d60b9b6dee84a53c37f05eefeb803787de04/tabby-electron/src/services/platform.service.ts#L425-L467)). Electerm also opens the final path directly. Cancellation stops new scheduling and closes the handle after a short wait ([transfer lifecycle](https://github.com/electerm/electerm/blob/e68e61e3d0a8b2f66840282a4fc3dc7c40798699/src/app/server/transfer.js#L340-L431)). They are useful speed and UI references, but not reliability baselines.

Netcatty's current replacement flow is stronger than Tabby and Electerm. Normal files are staged, symlinks are written in place, and cancellation is checked again before replacement. If both replacement and restoration fail, recovery files remain and the error reports usable paths ([replacement flow](https://github.com/binaricat/Netcatty/blob/e1793e382bf022f792a74cfca4d7de95c92bd5bf/electron/bridges/sftpBridge.cjs#L625-L875)). The resumable engine also records only the highest contiguous completed range, rather than mistaking aggregate progress for a resumable offset ([concurrent range scheduler](https://github.com/binaricat/Netcatty/blob/e1793e382bf022f792a74cfca4d7de95c92bd5bf/electron/bridges/transferBridge.cjs#L1225-L1445)).

## 3. Source changes and integrity

Tabby and Electerm inspect the source only once at transfer start, as does ssh2 `fastXfer`. OpenSSH explicitly warns that resume does not validate the existing prefix. Silently accepting source changes is common, but it is not safe.

Netcatty's local resumable upload is substantially stronger. It creates a compact SHA-256 chunk digest in Netcatty's temporary directory, rereads the source to confirm the baseline, and compares every range against the digest before sending it ([digest baseline](https://github.com/binaricat/Netcatty/blob/e1793e382bf022f792a74cfca4d7de95c92bd5bf/electron/bridges/transferBridge.cjs#L1121-L1220), [pre-write validation](https://github.com/binaricat/Netcatty/blob/e1793e382bf022f792a74cfca4d7de95c92bd5bf/electron/bridges/transferBridge.cjs#L1455-L1540)). Even on a file system with coarse timestamps, one upload cannot silently combine chunks from two local versions.

This follow-up PR routes legacy local uploads and progress-reporting memory uploads through the transfer engine, so they no longer bypass source-change checks and shared publication rules. Remote downloads also use the same scheduler. Local resumable upload still has stronger per-chunk evidence, while remote download mainly uses size, metadata, and selected-range checks. That difference reflects the evidence available from each source, not two independent entry-point implementations. A unified end-to-end digest remains a research topic.

One gap remains for **resume after an abnormal process exit**. Resume compares only the first 256 KiB of the staged file and current source ([resume sample limit](https://github.com/binaricat/Netcatty/blob/e1793e382bf022f792a74cfca4d7de95c92bd5bf/electron/bridges/transferBridge.cjs#L187-L205)). A complete source fingerprint is first recorded only when the user explicitly pauses ([pause fingerprint](https://github.com/binaricat/Netcatty/blob/e1793e382bf022f792a74cfca4d7de95c92bd5bf/electron/bridges/transferBridge.cjs#L2801-L2815)). If the process exits before a pause can persist that fingerprint and the source changes only after the first 256 KiB, resuming can preserve an old remote prefix and append bytes from the new source. This crash-recovery identity gap is distinct from per-chunk validation **during one process run**. The current branch's chunk digest prevents source changes during that run, but cannot prove that a stage from an earlier process belongs to the current source. The correct direction is to persist source identity and confirmed-prefix digests when transfer starts, then restart conservatively when that evidence is absent.

## 4. Symlinks, permissions, and failure recovery

Mature clients separate destination replacement from raw SFTP I/O:

- WinSCP avoids temporary-file replacement for known or suspected symlinks and for targets not owned by the current user, because rename replacement can change the node or owner ([source](https://github.com/winscp/winscp/blob/b9307ef5f866a14dded9a330d8a2b8848d16dc7f/source/core/SftpFileSystem.cpp#L4661-L4700)).
- WinSCP restores requested or existing modes and times after replacement, with explicit behavior for permission failures ([attribute handling](https://github.com/winscp/winscp/blob/b9307ef5f866a14dded9a330d8a2b8848d16dc7f/source/core/SftpFileSystem.cpp#L4800-L4839), [error handling](https://github.com/winscp/winscp/blob/b9307ef5f866a14dded9a330d8a2b8848d16dc7f/source/core/SftpFileSystem.cpp#L4972-L5033)).
- OpenSSH transfers regular files by default, does not follow symlinks during recursive transfer, and can preserve modes and times ([manual](https://github.com/openssh/openssh-portable/blob/7e446d3f5917c2f2770981a89d0e54d5d064bf0c/sftp.1#L637-L690)).

Netcatty prefers `lstat` and conservatively falls back to `stat` and `readlink` on servers without it. Symlinks are written in place; regular files are staged; and the previous mode is applied to the stage before replacement. The boundary must remain explicit: SFTP v3 cannot preserve ownership, access-control lists, extended attributes, or hard-link identity on every server. Keeping the same path and mode does not mean preserving every property of the old file node.

This follow-up PR removed the transfer engine's separate publication path. Normal, resumable, and server-to-server SFTP and SCP uploads now share one upload transaction for symlink handling, target changes, staging, backup restoration, permission restoration, cancellation, and recovery evidence. Entry points retain only the differences in how data is read and written.

## 5. Current Netcatty gaps and module-design issues

### High priority

1. **Add identity checks for resume after abnormal exit.** Comparing only the first 256 KiB cannot prove that a large source still matches a staged file. A fingerprint computed only during orderly pause cannot cover an earlier crash.
2. **Clarify integrity guarantees.** Local resumable upload has chunk digests, while remote download relies on size, metadata, and selected-range checks. Each source type should state what it proves and what it does not. A common end-to-end digest deserves further study.
3. **Split the oversized state module by responsibility.** It still combines admission, UI messages, session ownership, upload/download scheduling, pause/cancel, speed calculation, and integrity. The shared publication transaction removed the most dangerous duplicated rules; upload and download schedulers can next be separated while UI adapters remain thin.

### Medium priority

4. **Negotiate capability while preserving a safe floor.** Keep 32 KiB as the compatibility baseline and record `limits@openssh.com`, large-packet rejection, and per-host outcomes. Per-host request windows are safer than another global chunk change.
5. **Distinguish file concurrency from per-file request concurrency.** WinSCP's request queue operates within one file. Netcatty also has a global file-admission queue. They need distinct names, metrics, and messages.
6. **State metadata-loss boundaries.** Restoring modes is useful, but ownership, ACLs, extended attributes, sparse layout, hard links, and node identity are outside the current guarantee. Tests and UI should not imply full equivalence after replacement.
7. **Build a server compatibility matrix.** The ssh2-sftp-client warning is well founded: servers differ substantially in concurrent-transfer behavior ([documentation](https://github.com/theophilusx/ssh2-sftp-client/blob/c690045a5d05e40f86db6b7321c6e627071b6c4a/README.md#L1563-L1574)). Netcatty should repeatedly cover OpenSSH, Dropbear, Windows SFTP, NAS devices, elevated SFTP, missing `lstat`, missing `readlink`, and low `MaxSessions` environments.

## 6. Did PR #2452 address the right problem?

**Yes for the reported throughput problem; only partially for the wider architecture.**

- The old eight-request upload window was too small for the measured latency. Keeping 32 KiB chunks and raising the window to 32 is supported by Netcatty's tests and the shapes used by Electerm, OpenSSH, ssh2, and WinSCP.
- Refusing a silent serial fallback is correct. This feature exists for high throughput. Reporting incompatibility is more honest than silently turning minutes into hours.
- The review fixes were not unrelated polish. Concurrent requests require cancellation to drain or fully isolate outstanding operations. Aggregate progress is not a resumable checkpoint; only the contiguous completed position is. Cleanup must not race unfinished writes.
- The PR does not prove that 32 is optimal for every server. OpenSSH and WinSCP negotiate or adjust, and ssh2-sftp-client documents incompatible servers. Netcatty should retain internal configurability, collect diagnostic evidence, and only then consider changing the value.
- The merged PR revision is `ad2730113...`; this research also examines later hardening on working revision `e1793e382...`. Discussions of what was delivered at merge must not confuse those states.
- Three additional valid remote findings appeared after merge, covering SCP broken symlinks and broken-link detection without `lstat`. Their fixes are on the follow-up branch, not in the original merged result.

The shortest accurate conclusion is: **PR #2452 fixed the throughput bottleneck and materially improved safety; this follow-up PR then merged the previously split high-level entry points and file-publication rules into one path.**

## Evidence quality and limits

- Behavioral claims use official repositories, source code, first-party manuals, and the PR itself. No secondary article supports the performance or architecture conclusions.
- The two real-host throughput measurements in PR #2452 come from the maintainer's PR record. This research did not reconnect to those hosts. It independently verified the implementation path, request-window values, automated tests, and comparison-project source.
- Links for OpenSSH, WinSCP, ssh2, Tabby, and Electerm are pinned to revisions. Netcatty links distinguish the merge revision from the follow-up working branch.
- "Not found" means the cited application coordination path lacks a mechanism. It does not prove that a lower SSH library or server cannot buffer or add behavior.
- Tabby's russh internals and Electerm's SCP directory path were not used to infer single-file SFTP concurrency because their application code does not configure that window.
