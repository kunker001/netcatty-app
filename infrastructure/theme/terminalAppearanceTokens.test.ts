import test from 'node:test';
import assert from 'node:assert/strict';

import { getContrastRatio, getHslTokenRelativeLuminance } from '../../domain/colorContrast';
import { TERMINAL_THEMES } from '../config/terminalThemes';
import {
  buildSidePanelChromeThemeFromTerminalTheme,
  buildTerminalAppearanceCssVars,
  buildTerminalSidePanelCssVars,
} from './terminalAppearanceTokens';

test('buildTerminalAppearanceCssVars maps core terminal colors', () => {
  const vars = buildTerminalAppearanceCssVars({
    id: 'test',
    name: 'Test',
    type: 'light',
    colors: {
      background: '#f7f7f7',
      foreground: '#100f0f',
      cursor: '#24837b',
      selection: '#24837b44',
      black: '#000',
      red: '#000',
      green: '#000',
      yellow: '#000',
      blue: '#000',
      magenta: '#000',
      cyan: '#000',
      white: '#fff',
      brightBlack: '#000',
      brightRed: '#000',
      brightGreen: '#000',
      brightYellow: '#000',
      brightBlue: '#000',
      brightMagenta: '#000',
      brightCyan: '#000',
      brightWhite: '#fff',
    },
  });

  assert.equal(vars['--nc-term-bg'], '#f7f7f7');
  assert.equal(vars['--nc-term-fg'], '#100f0f');
  assert.equal(vars['--nc-term-panel-bg'], '#f7f7f7');
  assert.equal(vars['--nc-term-host-tree-bg'], '#f7f7f7');
});

test('buildSidePanelChromeThemeFromTerminalTheme uses resolved terminal colors', () => {
  const theme = buildSidePanelChromeThemeFromTerminalTheme({
    id: 'test',
    name: 'Test',
    type: 'light',
    colors: {
      background: '#f7f7f7',
      foreground: '#100f0f',
      cursor: '#24837b',
      selection: '#24837b44',
      black: '#000',
      red: '#000',
      green: '#000',
      yellow: '#000',
      blue: '#000',
      magenta: '#000',
      cyan: '#000',
      white: '#fff',
      brightBlack: '#000',
      brightRed: '#000',
      brightGreen: '#000',
      brightYellow: '#000',
      brightBlue: '#000',
      brightMagenta: '#000',
      brightCyan: '#000',
      brightWhite: '#fff',
    },
  });

  assert.equal(theme.termBg, '#f7f7f7');
  assert.equal(theme.termFg, '#100f0f');
  assert.equal(theme.accent, '#24837b');
  assert.match(theme.separator, /^color-mix\(/);
});

test('terminal side panel variables follow the terminal palette with readable selected text', () => {
  const vars = buildTerminalSidePanelCssVars({
    id: 'high-contrast-mismatch',
    name: 'High contrast mismatch',
    type: 'dark',
    colors: {
      background: '#000000',
      foreground: '#ffffff',
      cursor: '#ffffff',
      selection: '#ffffff44',
      black: '#000000',
      red: '#ff0000',
      green: '#00ff00',
      yellow: '#ffff00',
      blue: '#0000ff',
      magenta: '#ff00ff',
      cyan: '#00ffff',
      white: '#ffffff',
      brightBlack: '#000000',
      brightRed: '#ff0000',
      brightGreen: '#00ff00',
      brightYellow: '#ffff00',
      brightBlue: '#0000ff',
      brightMagenta: '#ff00ff',
      brightCyan: '#00ffff',
      brightWhite: '#ffffff',
    },
  });

  assert.equal(vars['--background'], '0 0% 0%');
  assert.equal(vars['--foreground'], '0 0% 100%');
  assert.notEqual(vars['--accent'], vars['--accent-foreground']);
  assert.equal(vars['--accent-foreground'], vars['--foreground']);
});

test('every built-in terminal theme keeps side panel text readable', () => {
  const pairs = [
    ['--foreground', '--background'],
    ['--muted-foreground', '--background'],
    ['--muted-foreground', '--muted'],
    ['--secondary-foreground', '--secondary'],
    ['--primary', '--background'],
    ['--accent-foreground', '--accent'],
    ['--primary-foreground', '--primary'],
    ['--destructive', '--background'],
    ['--destructive-foreground', '--destructive'],
  ] as const;

  for (const theme of TERMINAL_THEMES) {
    const vars = buildTerminalSidePanelCssVars(theme);
    for (const [foregroundKey, backgroundKey] of pairs) {
      const foregroundLuminance = getHslTokenRelativeLuminance(vars[foregroundKey]);
      const backgroundLuminance = getHslTokenRelativeLuminance(vars[backgroundKey]);
      assert.notEqual(foregroundLuminance, null, `${theme.id} ${foregroundKey}`);
      assert.notEqual(backgroundLuminance, null, `${theme.id} ${backgroundKey}`);
      assert.ok(
        getContrastRatio(foregroundLuminance as number, backgroundLuminance as number) >= 4.5,
        `${theme.id} ${foregroundKey}/${backgroundKey}`,
      );
    }
  }
});

test('Netcatty Light side panel tokens are light so color-scheme can match the composer', () => {
  const theme = TERMINAL_THEMES.find((entry) => entry.id === 'netcatty-light');
  assert.ok(theme);
  assert.equal(theme.type, 'light');
  const vars = buildTerminalSidePanelCssVars(theme);
  const backgroundLuminance = getHslTokenRelativeLuminance(vars['--background']);
  assert.notEqual(backgroundLuminance, null);
  assert.ok(
    (backgroundLuminance as number) > 0.5,
    'Netcatty Light --background must stay light for the AI composer surface',
  );
});
