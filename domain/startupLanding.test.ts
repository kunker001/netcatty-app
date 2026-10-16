import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_STARTUP_LANDING,
  isStartupLanding,
  resolveStartupLandingSetting,
  shouldOpenLocalTerminalOnStartup,
} from './startupLanding.ts';

test('startup landing defaults to vault', () => {
  assert.equal(DEFAULT_STARTUP_LANDING, 'vault');
  assert.equal(resolveStartupLandingSetting(null), 'vault');
  assert.equal(resolveStartupLandingSetting(undefined), 'vault');
  assert.equal(resolveStartupLandingSetting('nope'), 'vault');
});

test('startup landing accepts stored values', () => {
  assert.equal(isStartupLanding('vault'), true);
  assert.equal(isStartupLanding('local-terminal'), true);
  assert.equal(isStartupLanding('sftp'), false);
  assert.equal(resolveStartupLandingSetting('vault'), 'vault');
  assert.equal(resolveStartupLandingSetting('local-terminal'), 'local-terminal');
});

test('should open local terminal only for empty main-window cold start', () => {
  assert.equal(
    shouldOpenLocalTerminalOnStartup({
      startupLanding: 'local-terminal',
      hasRestoredSessionState: false,
      isPeerSessionWindow: false,
    }),
    true,
  );
  assert.equal(
    shouldOpenLocalTerminalOnStartup({
      startupLanding: 'vault',
      hasRestoredSessionState: false,
      isPeerSessionWindow: false,
    }),
    false,
  );
  assert.equal(
    shouldOpenLocalTerminalOnStartup({
      startupLanding: 'local-terminal',
      hasRestoredSessionState: true,
      isPeerSessionWindow: false,
    }),
    false,
  );
  assert.equal(
    shouldOpenLocalTerminalOnStartup({
      startupLanding: 'local-terminal',
      hasRestoredSessionState: false,
      isPeerSessionWindow: true,
    }),
    false,
  );
  assert.equal(
    shouldOpenLocalTerminalOnStartup({
      startupLanding: 'local-terminal',
      hasRestoredSessionState: false,
      isPeerSessionWindow: false,
      hasQueuedStartupIntent: true,
    }),
    false,
  );
});
