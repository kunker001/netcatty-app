import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const attachmentSource = readFileSync(new URL('./terminalSessionAttachment.ts', import.meta.url), 'utf8');
const startersSource = readFileSync(new URL('./createTerminalSessionStarters.ts', import.meta.url), 'utf8');

const hiddenPostConnectFitGuard =
  /setTimeout\(\(\) => \{\s*if \(ctx\.isVisibleRef\?\.current === false\) \{\s*notePendingOutputScrollIfEnabled\(ctx\);\s*return;\s*\}\s*if \(!ctx\.fitAddonRef\.current\) return;[\s\S]*ctx\.fitAddonRef\.current\.fit\(\)/;

test('reattached sessions do not fit hidden terminal panes after first output', () => {
  assert.match(attachmentSource, hiddenPostConnectFitGuard);
});

test('local sessions do not fit hidden terminal panes after first output', () => {
  assert.match(startersSource, hiddenPostConnectFitGuard);
});

test('hidden post-connect scroll recovery respects the scroll-on-output setting', () => {
  assert.match(
    attachmentSource,
    /export const notePendingOutputScrollIfEnabled[\s\S]*shouldScrollOnTerminalOutput\(settings\)[\s\S]*ctx\.pendingOutputScrollRef\.current = true/,
  );
});
