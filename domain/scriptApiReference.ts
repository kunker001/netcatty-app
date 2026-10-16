import { DEFAULT_SCRIPT_TEMPLATE } from './snippetScript.ts';

const WRAPPER_RULES = `## Script source wrapping

Netcatty executes scripts as async JavaScript in a Node vm sandbox:

- If the source is already an async IIFE or async arrow, it runs as-is.
- If the source contains \`async function main()\`, it is wrapped and \`await main()\` is called.
- Otherwise bare statements are wrapped in \`(async () => { ... })()\`.

Only JavaScript is executed. The \`language: python\` field is a UI label only — there is no Python runtime.`;

const TRIGGER_GUIDE = `## Triggers and host targeting

| trigger | Behavior |
|---------|----------|
| manual | Run from Vault or via scripts_run / snippets_run |
| onConnect | Runs after SSH connect (global targetsAllHosts, dynamic targetGroups, then host connectScriptIds queue) |
| onOutput | Runs when terminal output matches triggerPattern (regex) |

Use \`targets\` (host id array), \`targetGroups\` (dynamic group path array), or \`targetsAllHosts: true\` to scope runs. Group paths include nested groups and are resolved against the latest host inventory.
For per-host onConnect order, use \`host_connect_scripts_set\`. Group-scoped scripts remain inherited and are not copied into host queues.`;

const NCT_API = `## nct API reference

Global \`nct.version\` exposes the runtime version.

### nct.screen
- \`await nct.screen.waitForPrompt(ms?)\` — wait for shell prompt (# root / $ user)
- \`await nct.screen.waitForText(text, ms?)\` — wait for exact text; regex characters are treated literally
- \`await nct.screen.waitForRegex(pattern, ms?)\` — wait for regex output; string patterns match multiline output
- \`await nct.screen.waitFor(pattern, ms?)\` — compatibility helper; plain strings are literal, and legacy \`/regex/flags\` strings still work
- \`await nct.screen.waitForAny(patterns, ms?)\` — wait until any pattern matches
- \`await nct.screen.sendLine(cmd)\` — type command + Enter
- \`await nct.screen.send(text)\` — raw keys without Enter
- \`await nct.screen.getText(start?, end?)\` — read terminal buffer
- \`await nct.screen.clear()\` — clear screen
- Properties: \`rows\`, \`cols\`, \`currentRow\`

Use \`waitForText("请选择SSH资源")\` for literal prompts.
Use \`waitForRegex(".*请选择SSH资源.*登录方式.*")\` for regex or output split across terminal lines.

### nct.session
- \`nct.session.connected\` — whether the current terminal session is connected
- \`nct.session.name\` — session display name, usually the saved host label
- \`nct.session.hostname\` — hostname or address of the current session
- \`nct.session.username\` — username of the current session
- \`await nct.session.sleep(ms)\` — alias \`await nct.sleep(ms)\`
- \`await nct.session.startLog(path)\` / \`stopLog()\`
- \`await nct.session.disconnect()\`

### nct.dialog (requires non-Observer permission mode)
- \`await nct.dialog.confirm(msg)\` → boolean
- \`await nct.dialog.prompt(msg, default?)\` → string
- \`await nct.dialog.alert(msg)\`
- \`await nct.dialog.form({ title?, message?, fields })\` → object; fields support \`select\`, \`checkbox\`, \`radio\`, \`textarea\`, and \`number\`
- \`await nct.dialog.select(msg, options, default?)\` → string
- \`await nct.dialog.radio(msg, options, default?)\` → string
- \`await nct.dialog.checkbox(msg, defaultChecked?)\` → boolean

\`select\` and \`radio\` options may be strings or \`{ label, value, description?, disabled? }\`; option values must be non-empty and unique within the field.
\`textarea\` returns string values; \`number\` returns number values or \`undefined\` when optional and empty. \`number\` fields support submit-time \`min\`, \`max\`, and \`step\` validation.
Fields may use \`visibleWhen: { field, equals|notEquals|truthy|falsy }\` for conditional display; \`visibleWhen.field\` must reference an earlier field. Hidden fields are not validated and are omitted from the submitted object.
\`form\` returns an object keyed by visible field \`name\`. Field names must not be \`__proto__\`, \`prototype\`, or \`constructor\`. Text, number, select, and radio fields are required/defaulted by default; checkbox fields are optional boolean fields unless \`required: true\` is set.

### nct.progress
- \`nct.progress.start(label, total)\` — opt-in determinate bar
- \`nct.progress.step(detail?)\` / \`set(n, detail?)\` / \`done()\`

### nct.log
- \`nct.log(message)\` — append to script run log panel`;

/** Markdown reference for AI agents — single source for scripts_reference tool and prompts. */
export function getScriptApiReference(): string {
  return [
    '# Netcatty automation script reference',
    '',
    'Automation scripts are Vault snippets with `kind: "script"`. They run in the active terminal session via the nct JavaScript API.',
    '',
    WRAPPER_RULES,
    '',
    TRIGGER_GUIDE,
    '',
    NCT_API,
    '',
    '## Minimal template',
    '',
    '```javascript',
    DEFAULT_SCRIPT_TEMPLATE.trim(),
    '```',
  ].join('\n');
}
