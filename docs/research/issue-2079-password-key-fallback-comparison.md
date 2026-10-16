# Issue #2079: password selection versus automatic key fallback

Research date: 2026-07-13

Source revisions:

- Netcatty PR #2153 head: `f10bbc70d02fca70427852568ab47636e93282f5`
- Tabby: `18fa6959bd95f24b72403c8f22a4eb002b53adcf` (v1.0.234)
- Electerm: `e473f5d172daf08ca82d7bdc9ebe14690820ca23`
- PuTTY manual: 0.83
- WinSCP official documentation: checked 2026-07-13

## Conclusion

PR #2153 is a reasonable change **if Netcatty's “Password” choice means an explicit authentication mode**. Tabby follows exactly that contract: Auto may try keys, the system agent, password, and interactive prompts, while selecting Password excludes file-key and agent methods. PuTTY reaches the same outcome through a separate control: agent use is enabled by default, but its manual tells users to disable it when they need to force password authentication.

It is not accurate to present the change as matching OpenSSH's default behavior. OpenSSH defaults to automatic negotiation, prefers public-key authentication before password, searches standard `~/.ssh/id_*` files, and may use agent identities. A strict password-only OpenSSH invocation requires explicit configuration, such as disabling public-key authentication or restricting the preferred method list.

Electerm demonstrates the other defensible product choice: a supplied password is attempted first, but its separately enabled SSH-agent option remains eligible afterward. Therefore there is no universal competitor convention. The important contract is that “Auto” and “Password only” are distinguishable and that terminal, jump-host, and SFTP paths implement the same contract.

For Netcatty, the strongest follow-up would be to make the UI wording unambiguous: either rename the existing choice to “Password only,” or add an explicit “Automatic” mode for users who want OpenSSH-like fallback. PR #2153 itself correctly removes the surprising inconsistency where direct terminal login could hide a stale password while jump-host and SFTP login exposed it.

## Behavior comparison

| Client / mode | Tries local default keys or agent when a password is available? | How to force password | Jump host and SFTP |
|---|---|---|---|
| OpenSSH default | Yes. `publickey` precedes `password`, default identity files are configured automatically, and agent identities may participate. | Explicitly disable public-key authentication, or restrict the enabled/preferred methods. | ProxyJump authenticates the jump host separately. OpenSSH SFTP uses the same SSH transport and accepts the same SSH configuration. |
| Tabby Auto | Yes. It constructs file-key attempts, targeted/full agent attempts, saved password, and prompts. | Select Password; the source then constructs saved/prompted password methods but excludes file-key and agent methods. | Each jump profile is authenticated according to its own profile settings; SFTP runs over the authenticated SSH session. |
| PuTTY default | Yes for Pageant; agent authentication is enabled by default. | Disable “Attempt authentication using Pageant”; the manual says this may be needed to force password authentication. | PuTTY-family tools expose the same agent control as a saved-session setting. |
| WinSCP default | Yes. Its documented order puts agent and configured-file public keys before keyboard-interactive and password. | Disable “Attempt Authentication Using Agent”; the official page says this may be needed to force password. | This is WinSCP's SFTP/SCP SSH authentication policy, so file transfer itself uses the broad automatic order. |
| Electerm default bookmark | Usually yes for the agent. A supplied password is first, then an explicit key if present, then the enabled agent. Its bookmark default enables agent use. | Disable the bookmark's SSH-agent switch. | The same connection options and ordered authentication handler are used by its SSH session implementation. |
| Netcatty after #2153, password-only predicate | No automatic standard `~/.ssh/id_*` or implicit system-agent fallback. Password and keyboard-interactive remain. An explicitly configured key/agent makes the connection no longer password-only. | This is the effective behavior of a password with no configured key, certificate, or agent. | The PR aligns direct terminal with the existing jump-host/SFTP helper behavior. |

## OpenSSH: automatic by default, strict only when requested

OpenSSH's default `PreferredAuthentications` order is `gssapi-with-mic,hostbased,publickey,keyboard-interactive,password`; the option controls the order in which enabled methods are tried ([official `ssh_config` manual](https://man.openbsd.org/ssh_config#PreferredAuthentications)). Its default `IdentityFile` list includes standard files such as `~/.ssh/id_rsa` and `~/.ssh/id_ed25519`, and the same directive can select a corresponding private identity already loaded in `ssh-agent` ([official `IdentityFile` documentation](https://man.openbsd.org/ssh_config#IdentityFile)).

Consequently, “a password exists” is not an OpenSSH mode. OpenSSH does not normally receive a saved password in configuration; it negotiates enabled methods and asks for a password only if that method is reached. With defaults, a usable key may succeed before the password is ever tested. Saying that OpenSSH “falls back to a key after a wrong password” would therefore be misleading for its normal order.

`IdentitiesOnly yes` is also not password-only. It limits extra identities offered by an agent or provider, but still allows configured/default identity files ([official documentation](https://man.openbsd.org/ssh_config#IdentitiesOnly)). To disable key authentication, OpenSSH exposes `PubkeyAuthentication no` ([official documentation](https://man.openbsd.org/ssh_config#PubkeyAuthentication)); to disable only the agent, it exposes `IdentityAgent none` ([official documentation](https://man.openbsd.org/ssh_config#IdentityAgent)).

ProxyJump makes an independent SSH connection to the jump host and then opens forwarding to the destination. The destination host's settings are not generally applied to the jump host, so the jump host needs its own matching configuration ([official `ProxyJump` documentation](https://man.openbsd.org/ssh_config#ProxyJump)). OpenSSH SFTP operates over SSH and directly passes `-F`, `-i`, `-J`, and `-o` options to `ssh`, so its authentication behavior is intentionally shared with terminal SSH ([official `sftp` manual](https://man.openbsd.org/sftp)).

## Tabby: Auto is broad; Password is exclusive

Tabby's profile default leaves the authentication selector unset, which represents Auto ([profile defaults](https://github.com/Eugeny/tabby/blob/18fa6959bd95f24b72403c8f22a4eb002b53adcf/tabby-ssh/src/profiles.ts#L15-L48)). In Auto, its session initialization adds configured or automatically located private keys, targeted and full-agent attempts, a saved password if available, and interactive password methods ([authentication construction](https://github.com/Eugeny/tabby/blob/18fa6959bd95f24b72403c8f22a4eb002b53adcf/tabby-ssh/src/session/ssh.ts#L152-L260)).

The conditions in that same source are explicit: file keys are added only for Auto or `publicKey`, agent methods only for Auto or `agent`, and password methods only for Auto or `password`. Selecting Password therefore does not silently use local keys or the system agent. This is the closest primary-source analogue to the semantics introduced by Netcatty PR #2153.

Tabby's agent behavior is more careful than a raw scan: where configured key paths exist, it first reads matching public `.pub` files and asks the agent to try those identities, then adds a full-agent fallback ([source](https://github.com/Eugeny/tabby/blob/18fa6959bd95f24b72403c8f22a4eb002b53adcf/tabby-ssh/src/session/ssh.ts#L203-L245)). This is relevant only to Auto/Agent modes; it does not weaken explicit Password mode.

## PuTTY: automatic agent use with an explicit opt-out

PuTTY enables “Attempt authentication using Pageant” by default and tries suitable keys loaded in Pageant. Its official manual describes this as normally desirable, then states that users may need to turn it off to force a non-public-key method such as passwords ([PuTTY 0.83 manual, section 4.21.4](https://the.earth.li/~sgtatham/putty/0.83/htmldoc/Chapter4.html#config-ssh-tryagent)).

If a specific private/public key is configured while Pageant is running, PuTTY first asks Pageant for that identity and ignores unrelated agent keys; only if that fails does it fall back to the local key/passphrase path ([PuTTY 0.83 manual, section 4.22.1](https://the.earth.li/~sgtatham/putty/0.83/htmldoc/Chapter4.html#config-ssh-privkey)). This reinforces the broader pattern: broad automatic behavior is acceptable when visible and controllable, while strict credential choices should be respected.

## Electerm: password first, agent still eligible

Electerm's ordered handler adds `password` when supplied, then `publickey` when a key is supplied, then `agent` when agent use is enabled, followed by keyboard-interactive ([source](https://github.com/electerm/electerm/blob/e473f5d172daf08ca82d7bdc9ebe14690820ca23/src/app/server/session-ssh.js#L58-L80)). Its bookmark form enables SSH-agent use by default ([source](https://github.com/electerm/electerm/blob/e473f5d172daf08ca82d7bdc9ebe14690820ca23/src/client/components/bookmark-form/config/ssh.js#L10-L31)), using a bookmark socket or `SSH_AUTH_SOCK` ([source](https://github.com/electerm/electerm/blob/e473f5d172daf08ca82d7bdc9ebe14690820ca23/src/app/server/session-ssh.js#L53-L56)).

Thus a wrong saved password can still be followed by a successful agent attempt unless the user disables agent use. Electerm does not establish that Netcatty's old behavior was wrong in all products; it establishes that credential selection and agent enablement can be separate controls. Unlike Netcatty's old direct path, this policy is represented in Electerm's bookmark setting rather than being an unexposed local-default-key fallback.

## WinSCP: SFTP also defaults to automatic negotiation

WinSCP documents its actual SSH authentication order as GSSAPI, public key via the agent, public key via a configured file, keyboard-interactive, then password ([official SSH overview](https://winscp.net/eng/docs/ssh#authentication)). Its SFTP/SCP site settings enable “Attempt Authentication Using Agent” by default, while exposing a switch to turn it off specifically when a user needs to force a non-public-key method such as password ([official authentication settings](https://winscp.net/eng/docs/ui_login_authentication#authentication_options)).

This is useful corroboration because WinSCP is primarily a file-transfer client: broad key-first behavior is not limited to interactive terminals. It also shows why Netcatty's old inconsistency was the real defect. Either automatic negotiation or password-only can be defensible, but a terminal and an SFTP view for the same saved host should not silently apply different policies.

## Implications for PR #2153

The PR defines password-only as a provided password with no user key, certificate, or configured agent, then suppresses automatic default-key discovery and implicit agent fallback for that case ([direct-session implementation](https://github.com/binaricat/Netcatty/blob/f10bbc70d02fca70427852568ab47636e93282f5/electron/bridges/sshBridge/startSession.cjs#L759-L838), [shared jump/SFTP helper](https://github.com/binaricat/Netcatty/blob/f10bbc70d02fca70427852568ab47636e93282f5/electron/bridges/sshAuthHelper.cjs#L838-L922)). Its regression tests preserve default keys when no credential is configured and preserve fallback when the user configures both a key and password ([PR files](https://github.com/binaricat/Netcatty/pull/2153/files)).

That scope is sound:

1. It respects Netcatty's existing explicit Password/Key selection model rather than treating every host as OpenSSH Auto.
2. It prevents stale passwords from being masked by unrelated local machine state.
3. It makes direct terminal, jump-host, and SFTP diagnostics consistent.
4. It does not remove key convenience globally: hosts without explicit credentials still try the system agent/default keys, and explicit agent/key configurations remain eligible.

Two nuances should remain visible in product decisions:

- The change is a **strict-mode product decision**, not an OpenSSH-default compatibility fix. If users expect OpenSSH Auto, Netcatty should expose Auto explicitly rather than overloading Password.
- The PR deliberately keeps already-unlocked encrypted keys eligible on a retry path after the user has entered a key passphrase ([source](https://github.com/binaricat/Netcatty/blob/f10bbc70d02fca70427852568ab47636e93282f5/electron/bridges/sshBridge/startSession.cjs#L899-L925)). That is no longer a silent fallback, but it means the internal predicate is not an absolute guarantee that only password packets can ever be sent during the entire retry lifecycle.

## Recommended product wording

Use three clearly separated concepts:

- **Automatic**: system agent, configured/default keys, then password/interactive methods; intended to feel like OpenSSH/Tabby Auto.
- **Password only**: password and password-like keyboard-interactive prompts; no local-key or agent fallback unless the user explicitly changes mode.
- **Key / System SSH Agent**: only the configured key source, with any fallback stated in the UI.

Whichever model is chosen, apply it identically to terminal, SFTP, command execution, port forwarding, and every jump-host hop.

## Verification performed

- Read issue #2079 and PR #2153, including both commits and the full changed-file patch.
- Traced the merged password-only predicates and regression tests at the PR head revision.
- Checked the official OpenSSH manuals for default ordering, identity discovery, strict controls, ProxyJump, and SFTP option forwarding.
- Inspected pinned Tabby and Electerm source for authentication-method construction and agent controls.
- Checked PuTTY's official 0.83 manual for default Pageant behavior and its explicit opt-out.
- Checked WinSCP's official authentication-order and SFTP site-setting documentation.
- Ran local `ssh -G` expansion to confirm standard identity files and the `publickey`/`password` defaults on the research machine, then confirmed an explicit password-only override disables public-key authentication.
