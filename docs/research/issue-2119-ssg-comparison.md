# Issue #2119: macOS SSH agent handling in Tabby and Electerm

Research date: 2026-07-12

Source revisions:

- Netcatty: `c096a64d7a7015e18100b842614c26e8eaadfcb3`
- Tabby: `18fa6959bd95f24b72403c8f22a4eb002b53adcf`
- Electerm: `e473f5d172daf08ca82d7bdc9ebe14690820ca23`

## Executive conclusion

Netcatty can and should borrow the competitors' common foundation: import `~/.ssh/config` as clickable hosts and authenticate through the already-running system SSH agent via its socket, without copying a private key or passphrase into the application.

Tabby is the stronger reference for the difficult part. When an imported host has `IdentityFile`, it reads the corresponding public `.pub` file and asks the agent to use that specific identity first; if that cannot be done, it falls back to trying the agent's full identity list. This avoids both reading/decrypting the private key and the common “too many authentication attempts” failure. The behavior was added specifically for this problem in [Tabby PR #10953](https://github.com/Eugeny/tabby/pull/10953) and shipped in [v1.0.230](https://github.com/Eugeny/tabby/releases/tag/v1.0.230).

Electerm is a useful reference for simple product behavior: agent use is enabled by default, each bookmark can disable it or provide a custom socket path, and a real integration test covers implicit `SSH_AUTH_SOCK` discovery. However, its SSH-config conversion does not faithfully preserve the issue's configuration: `IdentitiesOnly yes` becomes `useSshAgent: false`. That mapping should not be copied.

Neither application directly reads a private-key passphrase from macOS Keychain. Both rely on an identity already loaded into an SSH agent. `UseKeychain yes` and `AddKeysToAgent yes` therefore do not, by themselves, make the application load or unlock the key.

## What issue #2119 is asking for

[Netcatty issue #2119](https://github.com/binaricat/Netcatty/issues/2119) supplies this OpenSSH configuration:

```sshconfig
Host aws-sg
  HostName 1.1.1.1
  Port 2222
  User root
  AddKeysToAgent yes
  UseKeychain yes
  IdentityFile ~/.ssh/aws_root
  IdentitiesOnly yes
```

The requested outcome has two independent requirements:

1. `aws-sg` appears as a clickable host in the application's UI.
2. The application's built-in SSH client signs through the macOS SSH agent, so Netcatty does not store the private key or its passphrase.

The Keychain and agent roles must not be conflated. The application speaks the SSH-agent protocol through a socket. The macOS/OpenSSH tools are responsible for putting an unlocked identity into that agent. A reliable acceptance check is therefore: the desired public identity is visible to the agent before Netcatty connects.

## Comparison

| Question | Tabby | Electerm |
|---|---|---|
| Are SSH-config hosts shown in the UI? | Yes, as built-in profiles grouped under “Imported from .ssh/config.” | Yes, after an import prompt, as normal SSH bookmarks in an “ssh configs” group. |
| Is system agent use available? | Yes. “Auto” auth includes agent auth. On macOS/Linux it uses an override path or `SSH_AUTH_SOCK`. | Yes, enabled by default. A bookmark can specify a path; otherwise it uses `SSH_AUTH_SOCK`. |
| Does it directly read macOS Keychain? | No evidence of this. | No evidence of this. |
| Does it faithfully implement `UseKeychain`? | No; the importer does not map it. | No; the importer retains it only as extra descriptive data. |
| Does it faithfully implement `AddKeysToAgent`? | No; the importer does not map it and Tabby does not add the key. | No; the parser records it, but bookmark conversion does not use it to add/load a key. |
| Does it faithfully implement `IdentitiesOnly`? | No. It does targeted agent auth when `IdentityFile` exists, regardless of this flag, then deliberately falls back to all agent keys. | No. `IdentitiesOnly yes` is converted into “do not use agent,” which is not OpenSSH's meaning. |
| Is `IdentityFile` used to select an agent identity? | Yes. It loads `<IdentityFile>.pub`, tries that identity through the agent first, then falls back to the full agent. | No. Agent use and file-key use are separate attempts; no per-identity agent filtering was found. |
| Default direct-login order | Auto builds file-key attempts before targeted-agent and full-agent attempts. Selecting “Agent” restricts the path to agent attempts. | `none`, password if present, private key if present, agent if present, then keyboard-interactive. With no explicit credentials it also scans `~/.ssh` keys, so a file key can precede the agent. |

## Tabby

### Host import

Tabby recursively reads `~/.ssh/config`, expands `Include`, and invalidates its cache when any included file changes ([source](https://github.com/Eugeny/tabby/blob/18fa6959bd95f24b72403c8f22a4eb002b53adcf/tabby-electron/src/sshImporters.ts#L104-L157)). It creates stable UI profiles named `<alias> (.ssh/config)` in an imported group ([source](https://github.com/Eugeny/tabby/blob/18fa6959bd95f24b72403c8f22a4eb002b53adcf/tabby-electron/src/sshImporters.ts#L169-L181)), and imports non-wildcard hosts with a resolved `HostName` ([source](https://github.com/Eugeny/tabby/blob/18fa6959bd95f24b72403c8f22a4eb002b53adcf/tabby-electron/src/sshImporters.ts#L319-L366)). `IdentityFile` is mapped to profile private-key paths ([source](https://github.com/Eugeny/tabby/blob/18fa6959bd95f24b72403c8f22a4eb002b53adcf/tabby-electron/src/sshImporters.ts#L35-L52), [conversion](https://github.com/Eugeny/tabby/blob/18fa6959bd95f24b72403c8f22a4eb002b53adcf/tabby-electron/src/sshImporters.ts#L273-L284)).

The import map contains `IdentityFile` and `ForwardAgent`, but not `UseKeychain`, `AddKeysToAgent`, or `IdentitiesOnly` ([source](https://github.com/Eugeny/tabby/blob/18fa6959bd95f24b72403c8f22a4eb002b53adcf/tabby-electron/src/sshImporters.ts#L35-L52)). Consequently, Tabby does not reproduce those three OpenSSH directives.

### Agent discovery and product controls

Tabby's profile editor offers explicit Auto, Password, Key, Agent, and Interactive choices ([source](https://github.com/Eugeny/tabby/blob/18fa6959bd95f24b72403c8f22a4eb002b53adcf/tabby-ssh/src/components/sshProfileSettings.component.pug#L112-L170)); Auto is the profile default ([source](https://github.com/Eugeny/tabby/blob/18fa6959bd95f24b72403c8f22a4eb002b53adcf/tabby-ssh/src/profiles.ts#L15-L48)).

On non-Windows platforms, Tabby selects a configured socket path first and otherwise uses `process.env.SSH_AUTH_SOCK`; it validates that the path is a Unix socket and emits a useful message when unavailable ([source](https://github.com/Eugeny/tabby/blob/18fa6959bd95f24b72403c8f22a4eb002b53adcf/tabby-ssh/src/session/ssh.ts#L331-L350)). There is no macOS-specific Keychain call in this path.

### Identity-targeted agent authentication

When agent auth is allowed and `IdentityFile` paths exist, Tabby reads the matching `.pub` files, parses their public identities, and adds targeted agent methods before a full-agent fallback ([source](https://github.com/Eugeny/tabby/blob/18fa6959bd95f24b72403c8f22a4eb002b53adcf/tabby-ssh/src/session/ssh.ts#L203-L245)). At authentication time, targeted methods call `authenticateWithAgentIdentity`; the fallback calls ordinary `authenticateWithAgent` ([source](https://github.com/Eugeny/tabby/blob/18fa6959bd95f24b72403c8f22a4eb002b53adcf/tabby-ssh/src/session/ssh.ts#L769-L779)).

Strictly speaking, Tabby does not permanently filter the agent's identity list. It performs a targeted attempt first and then intentionally tries the full list. That is a compatibility tradeoff: it addresses server attempt limits while preserving older behavior if the `.pub` file is absent or stale. [PR #10953](https://github.com/Eugeny/tabby/pull/10953) documents the motivation, ordering, `.pub` dependency, and fallback.

One limitation for #2119 is that Auto also loads the private key as a direct file-key method before building agent methods ([source](https://github.com/Eugeny/tabby/blob/18fa6959bd95f24b72403c8f22a4eb002b53adcf/tabby-ssh/src/session/ssh.ts#L161-L203)). For an encrypted key this can lead to Tabby's own passphrase prompt before agent auth. Choosing the explicit Agent method avoids direct private-key loading. This is a product detail Netcatty can improve on by treating an imported agent-backed host as agent-first without requiring a manual mode change.

## Electerm

### Host import

Electerm calls `ssh-config-loader` to read and convert SSH config ([source](https://github.com/electerm/electerm/blob/e473f5d172daf08ca82d7bdc9ebe14690820ca23/src/app/lib/ssh-config.js#L9-L12)). The UI lets the user review/import the results ([source](https://github.com/electerm/electerm/blob/e473f5d172daf08ca82d7bdc9ebe14690820ca23/src/client/components/ssh-config/load-ssh-configs.jsx#L37-L58)), and imported entries become standard SSH bookmarks in an `ssh configs` group ([source](https://github.com/electerm/electerm/blob/e473f5d172daf08ca82d7bdc9ebe14690820ca23/src/client/store/bookmark.js#L29-L58)). This feature originated in [PR #4212](https://github.com/electerm/electerm/pull/4212).

Electerm pins `ssh-config-loader` 1.1.2 ([official lock file](https://github.com/electerm/electerm/blob/e473f5d172daf08ca82d7bdc9ebe14690820ca23/package-lock.json#L12198-L12206)). Running that exact published converter against the issue's exact block produced:

```json
{
  "authType": "privateKey",
  "privateKeyPath": "~/.ssh/aws_root",
  "useSshAgent": false,
  "description": "SSH to 1.1.1.1 | Extra: usekeychain=yes"
}
```

This establishes the directive behavior precisely:

- `IdentityFile` becomes a local private-key path.
- `UseKeychain` is retained only as extra descriptive text.
- `AddKeysToAgent` is parsed but has no bookmark effect.
- `IdentitiesOnly yes` disables agent use.

Thus Electerm can satisfy #2119 through a manually created agent-enabled bookmark, but importing the exact supplied config does not satisfy it.

### Agent discovery and product controls

Agent use defaults to `true` for SSH bookmarks ([source](https://github.com/electerm/electerm/blob/e473f5d172daf08ca82d7bdc9ebe14690820ca23/src/client/components/bookmark-form/config/ssh.js#L10-L31)). Each bookmark exposes an enable switch and optional agent path ([source](https://github.com/electerm/electerm/blob/e473f5d172daf08ca82d7bdc9ebe14690820ca23/src/client/components/bookmark-form/common/ssh-agent.jsx#L9-L30)). The official wiki describes the same behavior ([SSH agent wiki](https://github.com/electerm/electerm/wiki/ssh-agent)).

At connection time, Electerm uses the bookmark path if present and otherwise `process.env.SSH_AUTH_SOCK` ([source](https://github.com/electerm/electerm/blob/e473f5d172daf08ca82d7bdc9ebe14690820ca23/src/app/server/session-ssh.js#L53-L56)), then passes it to its SSH library ([source](https://github.com/electerm/electerm/blob/e473f5d172daf08ca82d7bdc9ebe14690820ca23/src/app/server/session-ssh.js#L695-L711)). A real integration test starts an agent, adds a key, exposes only `SSH_AUTH_SOCK`, and successfully connects ([source](https://github.com/electerm/electerm/blob/e473f5d172daf08ca82d7bdc9ebe14690820ca23/test/unit-ci/session-ssh-agent.spec.js#L329-L368)).

### Authentication ordering

Electerm's direct-login order is explicit in `getAuthOrder`: `none`, password, private key, agent, keyboard-interactive, and then host-based if applicable ([source](https://github.com/electerm/electerm/blob/e473f5d172daf08ca82d7bdc9ebe14690820ca23/src/app/server/session-ssh.js#L58-L80)). If no password/private key was supplied, the direct-session path scans `~/.ssh` for key pairs and loads one before connecting ([key scan](https://github.com/electerm/electerm/blob/e473f5d172daf08ca82d7bdc9ebe14690820ca23/src/app/server/session-ssh.js#L513-L545), [invocation](https://github.com/electerm/electerm/blob/e473f5d172daf08ca82d7bdc9ebe14690820ca23/src/app/server/session-ssh.js#L764-L780)); the path is indeed the user's `~/.ssh` directory ([source](https://github.com/electerm/electerm/blob/e473f5d172daf08ca82d7bdc9ebe14690820ca23/src/app/common/app-props.js#L37-L43)). Therefore “agent enabled by default” does not mean “agent first” for direct connections when a file key is available.

Electerm does test that a wrong file key is attempted and rejected before the agent succeeds ([source](https://github.com/electerm/electerm/blob/e473f5d172daf08ca82d7bdc9ebe14690820ca23/test/unit-ci/session-ssh-agent.spec.js#L265-L324)). It also contains a compatibility fix so agent auth remains eligible when a server reports only `publickey`, not a literal `agent` method ([source](https://github.com/electerm/electerm/blob/e473f5d172daf08ca82d7bdc9ebe14690820ca23/src/app/server/session-ssh.js#L82-L90), [fix commit](https://github.com/electerm/electerm/commit/f05ef847b774a95d4b3ddf9e06ba5a27220ac419)).

## Netcatty gap at the researched revision

Netcatty already has most of the plumbing:

- It imports non-wildcard SSH-config hosts and attaches `IdentityFile` paths ([source](https://github.com/binaricat/Netcatty/blob/c096a64d7a7015e18100b842614c26e8eaadfcb3/domain/vaultImport.ts#L456-L512), [host creation](https://github.com/binaricat/Netcatty/blob/c096a64d7a7015e18100b842614c26e8eaadfcb3/domain/vaultImport.ts#L529-L556)).
- It discovers the non-Windows agent from `SSH_AUTH_SOCK` and validates the socket ([source](https://github.com/binaricat/Netcatty/blob/c096a64d7a7015e18100b842614c26e8eaadfcb3/electron/bridges/sshAuthHelper.cjs#L463-L495)).
- With no explicit auth, it already tries the agent before default keys ([source](https://github.com/binaricat/Netcatty/blob/c096a64d7a7015e18100b842614c26e8eaadfcb3/electron/bridges/sshAuthHelper.cjs#L554-L564), [ordering](https://github.com/binaricat/Netcatty/blob/c096a64d7a7015e18100b842614c26e8eaadfcb3/electron/bridges/sshAuthHelper.cjs#L637-L678)).

The gap is the combination of those features. An imported `IdentityFile` is treated as a user-configured key. Before connecting, Netcatty reads/decrypts it and can show its own passphrase prompt ([source](https://github.com/binaricat/Netcatty/blob/c096a64d7a7015e18100b842614c26e8eaadfcb3/electron/bridges/sshBridge/startSession.cjs#L644-L690)). Agent-first fallback runs only when no key/password/agent was prepared ([source](https://github.com/binaricat/Netcatty/blob/c096a64d7a7015e18100b842614c26e8eaadfcb3/electron/bridges/sshBridge/startSession.cjs#L740-L761)). If a key was prepared, direct-key auth precedes agent auth ([source](https://github.com/binaricat/Netcatty/blob/c096a64d7a7015e18100b842614c26e8eaadfcb3/electron/bridges/sshBridge/startSession.cjs#L807-L821)).

Netcatty's SSH-config importer also ignores `UseKeychain`, `AddKeysToAgent`, and `IdentitiesOnly`; its recognized block fields are visible in the parser ([source](https://github.com/binaricat/Netcatty/blob/c096a64d7a7015e18100b842614c26e8eaadfcb3/domain/vaultImport.ts#L456-L512)).

## Recommended phased design

### Phase 1: deliver the common case safely

Add an explicit per-host authentication choice such as “System SSH Agent,” plus “Auto” behavior that prefers a reachable system agent for an SSH-config-managed host. On macOS/Linux, use `SSH_AUTH_SOCK`; retain a manual socket override and show whether the socket is reachable. Do not read or prompt for an imported encrypted `IdentityFile` before trying the agent.

This phase directly solves #2119 when `aws_root` is already loaded in the macOS agent. It reuses Netcatty's existing socket support and changes selection/order rather than adding Keychain access.

Apply the same policy at every connection surface: terminal, SFTP, command execution, port forwarding, jump hosts, and background probes. Otherwise a host may connect in the terminal but still prompt for a key in SFTP or forwarding.

### Phase 2: target the configured identity, following Tabby

For each imported `IdentityFile`, read only the matching public `.pub` file. Wrap/delegate the system agent so only matching public identities are advertised for the first attempt, or add the equivalent targeted-agent operation. Keep the private key and passphrase outside Netcatty.

Recommended order for an Auto/agent-backed imported host:

1. `none`
2. agent with identities matching configured `IdentityFile` public keys
3. full system agent fallback, unless strict `IdentitiesOnly yes` is being honored
4. direct private-key/passphrase flow only after a clear user-approved fallback
5. password / keyboard-interactive as configured

If `.pub` is missing or cannot be parsed, report that targeted selection was unavailable; then either try the full agent or ask the user, depending on `IdentitiesOnly` policy. Tabby's `.pub`-first plus full-agent fallback is the proven compatibility baseline.

### Phase 3: faithfully model relevant SSH-config semantics

Preserve these directives as structured imported metadata:

- `IdentityFile`: candidate identity selectors, not automatically “read this private key now.”
- `IdentityAgent`: socket override when present.
- `IdentitiesOnly`: restrict which agent identities may be attempted; it does **not** mean disable the agent.
- `AddKeysToAgent` and `UseKeychain`: record them for transparency, but do not claim they are enforced unless Netcatty intentionally invokes platform OpenSSH tooling.

For strict `IdentitiesOnly yes`, do not perform the full-agent fallback. For absent/false, targeted-first then full-agent is reasonable. Import preview should explain which directives Netcatty uses and which remain owned by the user's OpenSSH setup.

### Phase 4: macOS robustness and diagnostics

Both competitors mainly trust the inherited `SSH_AUTH_SOCK`; Electerm additionally exposes a per-bookmark override. A packaged macOS GUI may not always have the same environment as the user's interactive shell, so provide:

- socket reachability and identity-count diagnostics;
- a user-selectable socket path when automatic discovery fails;
- a precise “agent reachable but target identity not loaded” state;
- a safe verification action equivalent to listing public identities, without exposing private material;
- clear fallback behavior rather than silently opening Netcatty's private-key passphrase prompt.

Direct macOS Keychain integration should be a separate feature, not a prerequisite for #2119. The agent boundary is smaller, cross-platform, and already present in Netcatty.

## Acceptance tests for a future implementation

1. Import the exact #2119 block and verify `aws-sg` appears with host, port, user, and identity metadata intact.
2. Start an agent with only `aws_root` loaded; connect without storing or prompting for the private key/passphrase.
3. Load more than the server's allowed number of unrelated keys, with `aws_root` late in the agent list; targeted identity still connects.
4. With `IdentitiesOnly yes`, verify unrelated agent identities are never attempted.
5. With `.pub` missing, verify the chosen fallback policy and diagnostic are explicit.
6. With no/inaccessible `SSH_AUTH_SOCK`, verify the host remains editable and the error points to agent availability rather than an incorrect key password.
7. Repeat the behavior for terminal, SFTP, exec, port forwarding, and jump-host connections.
8. Verify explicit Password and explicit Key modes keep their current priority and do not unexpectedly consult the agent.

## Verification performed for this research

- Read issue #2119 directly.
- Inspected the pinned Tabby and Electerm source revisions locally.
- Traced both applications from SSH-config import through connection authentication.
- Ran Electerm's exact locked `ssh-config-loader@1.1.2` against the issue's exact configuration and recorded the converted bookmark shown above.
- Inspected Netcatty's current import, identity-file preparation, socket discovery, and authentication ordering without modifying product code.
