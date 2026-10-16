# Script Dialog Form Examples

These examples can be pasted into a Netcatty automation script to test dialog form controls.

## 1. All Controls Smoke Test

Tests `select`, `radio`, `checkbox`, `textarea`, `number`, defaults, and returned values.

```javascript
const values = await nct.dialog.form({
  title: 'Dialog controls smoke test',
  message: 'Change a few values and submit.',
  fields: [
    {
      type: 'select',
      name: 'env',
      label: 'Environment',
      options: [
        { label: 'Development', value: 'dev' },
        { label: 'Staging', value: 'staging' },
        { label: 'Production', value: 'prod', description: 'Use carefully' },
      ],
      defaultValue: 'staging',
    },
    {
      type: 'radio',
      name: 'mode',
      label: 'Run mode',
      options: [
        { label: 'Dry run', value: 'dry-run', description: 'Preview only' },
        { label: 'Execute', value: 'execute' },
      ],
      defaultValue: 'dry-run',
    },
    {
      type: 'checkbox',
      name: 'verbose',
      label: 'Verbose output',
      defaultValue: true,
    },
    {
      type: 'textarea',
      name: 'notes',
      label: 'Notes',
      placeholder: 'Optional notes for this run',
      defaultValue: 'Testing script dialog controls.',
      required: false,
    },
    {
      type: 'number',
      name: 'retries',
      label: 'Retries',
      defaultValue: 3,
      min: 0,
      max: 10,
      step: 1,
    },
  ],
});

nct.log(JSON.stringify(values, null, 2));
await nct.dialog.alert(`Submitted:\n${JSON.stringify(values, null, 2)}`);
```

## 2. Required Validation Test

Submit with the fields empty first. The dialog should show required errors and remain open.

```javascript
const values = await nct.dialog.form({
  title: 'Required validation',
  message: 'Try submitting before filling the required fields.',
  fields: [
    {
      type: 'textarea',
      name: 'reason',
      label: 'Reason',
      placeholder: 'This field is required',
      defaultValue: '',
    },
    {
      type: 'number',
      name: 'ticket',
      label: 'Ticket number',
      placeholder: 'Required number',
    },
    {
      type: 'textarea',
      name: 'optionalNote',
      label: 'Optional note',
      required: false,
    },
  ],
});

nct.log(`reason=${values.reason}`);
nct.log(`ticket=${values.ticket}`);
nct.log(`optionalNote=${values.optionalNote ?? ''}`);
await nct.dialog.alert('Required validation passed.');
```

## 3. Conditional Display

Tests `visibleWhen`. Select `local` first: the remote fields should be hidden and omitted from the returned object. Select `remote`: the host field appears and becomes required because it is visible.
`visibleWhen.field` must reference a field defined earlier in the form.

```javascript
const values = await nct.dialog.form({
  title: 'Conditional display',
  message: 'Switch the target type and watch the visible fields change.',
  fields: [
    {
      type: 'select',
      name: 'target',
      label: 'Target',
      options: [
        { label: 'Local machine', value: 'local' },
        { label: 'Remote host', value: 'remote' },
      ],
      defaultValue: 'local',
    },
    {
      type: 'textarea',
      name: 'host',
      label: 'Remote host',
      placeholder: 'example.com',
      defaultValue: '',
      visibleWhen: { field: 'target', equals: 'remote' },
    },
    {
      type: 'number',
      name: 'sshPort',
      label: 'SSH port',
      defaultValue: 22,
      min: 1,
      max: 65535,
      step: 1,
      visibleWhen: { field: 'target', equals: 'remote' },
    },
    {
      type: 'checkbox',
      name: 'confirmRemote',
      label: 'I know this will target a remote host',
      defaultValue: false,
      visibleWhen: { field: 'target', equals: 'remote' },
    },
  ],
});

nct.log(JSON.stringify(values, null, 2));
await nct.dialog.alert(`Visible values only:\n${JSON.stringify(values, null, 2)}`);
```

## 4. Convenience Controls

Tests `select`, `radio`, and `checkbox` helper APIs.

```javascript
const env = await nct.dialog.select(
  'Pick environment',
  [
    { label: 'Development', value: 'dev' },
    { label: 'Production', value: 'prod' },
  ],
  'dev',
);

const mode = await nct.dialog.radio(
  'Pick mode',
  [
    { label: 'Dry run', value: 'dry-run' },
    { label: 'Execute', value: 'execute' },
  ],
  'dry-run',
);

const verbose = await nct.dialog.checkbox('Verbose output', true);

nct.log(`env=${env}, mode=${mode}, verbose=${verbose}`);
await nct.dialog.alert(`env=${env}\nmode=${mode}\nverbose=${verbose}`);
```

## 5. Safe Real Command Test

Uses form values to run a harmless command in the current terminal.

```javascript
const values = await nct.dialog.form({
  title: 'Safe command test',
  message: 'Choose a harmless command to run in this terminal.',
  fields: [
    {
      type: 'select',
      name: 'command',
      label: 'Command',
      options: [
        { label: 'Print working directory', value: 'pwd' },
        { label: 'Show current user', value: 'whoami' },
        { label: 'Show date', value: 'date' },
      ],
      defaultValue: 'pwd',
    },
    {
      type: 'number',
      name: 'delayMs',
      label: 'Delay before running (ms)',
      defaultValue: 500,
      min: 0,
      max: 5000,
      step: 100,
      required: false,
    },
    {
      type: 'textarea',
      name: 'prefix',
      label: 'Log prefix',
      defaultValue: 'Running command',
      required: false,
    },
  ],
});

if (values.delayMs) {
  await nct.sleep(values.delayMs);
}

nct.log(`${values.prefix || 'Running'}: ${values.command}`);
await nct.screen.sendLine(values.command);
await nct.screen.waitForPrompt(30000);
await nct.dialog.alert(`Command finished: ${values.command}`);
```
