# React Doctor triage

Baseline: `origin/main` at `ec257558`

Tool: React Doctor 0.7.6

Initial result: 1,517 diagnostics in 68 rule families

This report classifies every initial diagnostic by rule family. A classification
applies to every finding in that row unless the action column names an exception.
The scan is evidence, not an automatic change list: broad or behavior-sensitive
families stay deferred until they can be reviewed in a focused change.

Classification key:

- **Confirmed**: the code pattern is present and the stated failure is plausible.
- **Mixed**: the family contains both confirmed findings and false positives.
- **Needs review**: the pattern may be intentional or the safe fix depends on runtime behavior.
- **Advisory**: a design or optimization suggestion, not a demonstrated defect.
- **False positive**: surrounding code already enforces the required safety property.

## Security

| Rule | Count | Classification | Confidence | Action |
| --- | ---: | --- | --- | --- |
| `path-traversal-risk` | 1 | False positive | High | Attachment paths are resolved only to compare against files already registered for the same chat; unmatched paths are rejected before reading. |
| `public-env-secret-name` | 1 | Confirmed | High | The Google OAuth client secret is bundled into renderer code. Requires an authentication-flow decision and a separate security change. |
| `insecure-crypto-risk` | 2 | False positive | High | SHA-1 is used only to reproduce OpenSSH's `%C` connection-hash token, not for authentication, signatures, or secret storage. |
| `build-pipeline-secret-boundary` | 1 | Needs review | Medium | CI dependency installation and signing authority should be reviewed together; changing install behavior can break native dependency setup. |
| `plugin-update-trust-risk` | 1 | Confirmed | High | The Linux build fallback downloads archive packages over HTTP without a digest check. Move to a focused supply-chain fix. |
| `agent-tool-capability-risk` | 1 | False positive | High | The flagged function wraps the catalog whose write tools already pass through permission modes and per-call approval. |

## Bugs

| Rule | Count | Classification | Confidence | Action |
| --- | ---: | --- | --- | --- |
| `effect-needs-cleanup` | 12 | Mixed | High | Fixed 9 timers. The other 3 already clean up through a stored timer/interval: `useAutoSync`, `usePortForwardingState`, and `TerminalConnectionDialog`. |
| `no-ref-current-in-render` | 215 | Needs review | Medium | Migration-scale. Many refs intentionally expose the freshest event data; move only in focused component changes with interaction tests. |
| `no-impure-state-updater` | 37 | Confirmed | Medium | Several updaters write captured variables or refs. Refactor by state owner because naive movement can persist stale state. |
| `no-prop-callback-in-render` | 33 | Needs review | Low | All are concentrated in the AI chat panel; verify whether each call derives display data or triggers an external effect. |
| `button-has-type` | 126 | Confirmed | High | Safe in principle, but spans 48 files. Handle as a mechanical, separately reviewed accessibility batch. |
| `exhaustive-deps` | 74 | Needs review | Medium | Existing deliberate dependency omissions and unstable callback identities require case-by-case analysis. |
| `no-cascading-set-state` | 25 | Needs review | Medium | Some effects intentionally synchronize external lifecycle state; focused hook tests are required. |
| `no-chain-state-updates` | 21 | Needs review | Medium | Consolidation may improve atomicity but can change render timing. |
| `no-array-index-as-key` | 18 | Confirmed | Medium | Replace only where a stable identity exists; static display-only lists are lower risk. |
| `prefer-use-effect-event` | 17 | Advisory | Medium | Modernization suggestion; not required to correct a demonstrated bug. |
| `no-pass-data-to-parent` | 15 | Needs review | Low | Callback direction is often intentional application-state orchestration. |
| `no-reset-all-state-on-prop-change` | 11 | Needs review | Medium | Some resets are intentional dialog/session lifecycle behavior. |
| `prefer-useReducer` | 11 | Advisory | High | State organization suggestion, not a correctness finding. |
| `no-prop-callback-in-effect` | 8 | Needs review | Medium | Verify callback semantics and identity before moving calls to event paths. |
| `no-adjust-state-on-prop-change` | 4 | Needs review | Medium | May represent intentional selection clamping or stale-state correction. |
| `no-pass-live-state-to-parent` | 4 | Needs review | Low | Requires ownership review rather than a local rewrite. |
| `no-effect-chain` | 3 | Needs review | Medium | Potentially mergeable, but ordering must be preserved. |
| `no-mirror-prop-effect` | 2 | Needs review | Medium | Confirm whether local edits intentionally diverge from incoming props. |
| `no-create-ref-in-function-component` | 1 | Confirmed | High | Replace with `useRef` in a focused component change. |
| `no-event-handler` | 1 | Needs review | Medium | Confirm whether the named prop is an actual event callback or just a function value. |
| `no-nested-component-definition` | 1 | Confirmed | High | Move the nested component to module scope in a focused UI change. |

## Accessibility

| Rule | Count | Classification | Confidence | Action |
| --- | ---: | --- | --- | --- |
| `no-static-element-interactions` | 82 | Confirmed | Medium | Migration-scale. Prefer real controls; preserve drag, selection, and context-menu behavior with interaction tests. |
| `control-has-associated-label` | 78 | Confirmed | High | Add accessible names in focused screen-level batches so wording can be reviewed. |
| `click-events-have-key-events` | 54 | Confirmed | Medium | Pair keyboard support with correct roles; avoid adding duplicate activation to nested controls. |
| `label-has-associated-control` | 21 | Confirmed | High | Associate labels explicitly, checking custom controls case by case. |
| `prefer-tag-over-role` | 5 | Advisory | High | Native elements are preferable, but replacement can affect styling and keyboard behavior. |
| `interactive-supports-focus` | 3 | Confirmed | High | Make custom interactive elements reachable or replace them with native controls. |
| `no-tiny-text` | 2 | Advisory | Medium | Visual-design decision; verify actual rendered size and hierarchy. |
| `aria-activedescendant-has-tabindex` | 1 | Confirmed | High | The owning composite needs a focus target. |
| `no-noninteractive-element-interactions` | 1 | Confirmed | High | Use a suitable control or remove the interaction. |
| `prefer-html-dialog` | 1 | Advisory | Medium | Existing dialog primitives may already provide equivalent focus management. |
| `role-supports-aria-props` | 1 | Confirmed | High | Align the role and ARIA attributes. |

## Performance

| Rule | Count | Classification | Confidence | Action |
| --- | ---: | --- | --- | --- |
| `rerender-memo-with-default-value` | 73 | Confirmed | Medium | Hoist defaults only where referential stability affects memoized children. |
| `js-combine-iterations` | 67 | Advisory | High | Optimize only measured hot paths; readability wins elsewhere. |
| `async-await-in-loop` | 34 | Needs review | High | Many operations are deliberately sequential for ordering, rate limits, or remote side effects. |
| `js-set-map-lookups` | 32 | Advisory | Medium | Useful for repeated large-list lookup, unnecessary for small lists. |
| `js-flatmap-filter` | 23 | Advisory | High | Micro-optimization; no demonstrated user impact. |
| `rerender-lazy-ref-init` | 14 | Confirmed | Medium | Use lazy initialization where construction is actually expensive. |
| `no-barrel-import` | 13 | Advisory | Medium | Vite tree-shaking and local organization reduce the claimed cost; validate bundle output before changing imports. |
| `js-index-maps` | 12 | Advisory | Medium | Apply only where repeated lookup dominates and cache invalidation is clear. |
| `no-inline-prop-on-memo-component` | 5 | Needs review | Medium | Stabilization helps only when child memoization and dependencies remain correct. |
| `jsx-no-constructed-context-values` | 3 | Confirmed | High | Memoize provider values in focused provider changes. |
| `no-usememo-simple-expression` | 3 | Advisory | High | Removing trivial memoization is cleanup, not a defect fix. |
| `no-layout-transition-inline` | 2 | Advisory | Medium | Animation design suggestion. |
| `rerender-state-only-in-handlers` | 2 | Needs review | Medium | State may intentionally trigger rendering outside the handler path. |
| `js-cache-property-access` | 1 | Advisory | High | Micro-optimization without measured impact. |
| `no-inline-bounce-easing` | 1 | Advisory | High | Animation design suggestion. |
| `no-json-parse-stringify-clone` | 1 | False positive | High | The finding is in a test fixture where JSON-compatible cloning is intentional and preserves the tested data shape. |
| `no-unstable-nested-components` | 1 | Confirmed | High | Move the nested SFTP dialog component to module scope in a focused UI change. |
| `prefer-dynamic-import` | 1 | Needs review | Medium | Validate startup and chunking behavior before splitting the dependency. |
| `rerender-lazy-state-init` | 1 | Confirmed | High | Use a lazy initializer if construction is non-trivial. |

## Maintainability

| Rule | Count | Classification | Confidence | Action |
| --- | ---: | --- | --- | --- |
| `only-export-components` | 139 | Advisory | Medium | This Electron app deliberately colocates tested helpers with components; split only when refresh behavior is affected. |
| `no-giant-component` | 67 | Advisory | High | Migration-scale architecture work; handle one feature boundary at a time. |
| `unused-export` | 64 | Needs review | Low | The scanner may miss Electron, test, generated, and dynamic entry points. Confirm with repository-wide and build-time usage before deletion. |
| `no-many-boolean-props` | 17 | Advisory | High | API design suggestion; variants are useful only where combinations are invalid. |
| `prefer-module-scope-pure-function` | 16 | Advisory | Medium | Hoist only functions that do not depend on render-local values. |
| `no-multi-comp` | 8 | Advisory | High | File organization preference, not a defect. |
| `prefer-module-scope-static-value` | 8 | Confirmed | Medium | Hoist stable values when it improves identity or avoids repeated work. |
| `unused-file` | 7 | Needs review | Low | Multiple Electron and generated entry points make automatic deletion unsafe. |
| `prefer-explicit-variants` | 4 | Advisory | High | Component API design suggestion. |
| `no-inline-exhaustive-style` | 2 | Advisory | Medium | Styling organization suggestion. |
| `unused-dependency` | 1 | Needs review | Medium | Confirm packaging and optional runtime loading before removal. |

## Applied fix batch

The first verified batch cancels deferred timers when the owning view closes or
its dependencies change. It covers the splash screen, saved-log terminal sizing,
approval focus, SFTP host-picker focus, terminal startup/font refits, and active-tab
scroll-state refresh. The change preserves the original delay and callback behavior.

The three remaining cleanup diagnostics are documented false positives because
their timers or intervals are already stored and cleared by an effect cleanup.

No React Doctor configuration, lint suppression, or dependency was added.
