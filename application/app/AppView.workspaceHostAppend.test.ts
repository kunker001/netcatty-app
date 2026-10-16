import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./AppView.tsx', import.meta.url), 'utf8');

test('workspace append resolves group defaults before creating host sessions', () => {
  assert.match(source, /resolveEffectiveTerminalHost\(\{/);
  assert.match(source, /groupConfigs,/);
  assert.match(source, /proxyProfiles,/);
  assert.match(
    source,
    /appendHostToWorkspace\(workspaceId, resolveWorkspaceAppendHost\(host\), rootDir\)/,
  );
  assert.match(
    source,
    /appendHostToWorkspace\([\s\S]*?resolveWorkspaceAppendHost\(target\.host\),[\s\S]*?rootDir/,
  );
});
