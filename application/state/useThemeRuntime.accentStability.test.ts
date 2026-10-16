import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtimeSource = readFileSync(new URL('./useThemeRuntime.ts', import.meta.url), 'utf8');
const terminalHostSource = readFileSync(
  new URL('../app/hosts/TerminalHost.tsx', import.meta.url),
  'utf8',
);

test('published currentTerminalTheme resolves without live custom accent', () => {
  // Base global appearance must use accentMode: 'theme' so HSL drag does not
  // mint a new theme object into TerminalHost / AppShell domain bags.
  assert.match(
    runtimeSource,
    /accentMode: 'theme',\s*\n\s*customAccent: '',/,
    'globalAppearance must ignore live custom accent',
  );
  assert.match(runtimeSource, /accentedGlobalAppearance/);
  assert.match(
    runtimeSource,
    /currentTerminalTheme: globalAppearance\.theme/,
    'published theme must come from the stable base appearance',
  );
});

test('TerminalHost injects accented appearance without bridging it', () => {
  assert.match(
    terminalHostSource,
    /useTerminalAppearanceInjection\(accentedGlobalAppearance/,
    'CSS vars still track live accent during drag',
  );
  const bridgeStart = terminalHostSource.indexOf('const themeBridgeActions = useMemo');
  assert.notEqual(bridgeStart, -1);
  const bridge = terminalHostSource.slice(bridgeStart, bridgeStart + 900);
  assert.match(bridge, /globalAppearance,/);
  assert.doesNotMatch(
    bridge,
    /accentedGlobalAppearance/,
    'theme bridge must not republish on accented appearance identity churn',
  );
});
