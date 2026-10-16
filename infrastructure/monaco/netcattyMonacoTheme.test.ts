import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildNetcattyMonacoThemeColors,
  type NetcattyEditorColors,
} from './netcattyMonacoTheme.ts';

const sampleColors: NetcattyEditorColors = {
  bg: '#ffffff',
  fg: '#1e1e1e',
  primary: '#0078d4',
  card: '#f3f3f3',
  mutedFg: '#858585',
  border: '#d4d4d4',
};

const isSemiTransparentHex = (value: string): boolean =>
  /^#[0-9a-fA-F]{8}$/.test(value) && !value.toLowerCase().endsWith('ff');

test('buildNetcattyMonacoThemeColors uses translucent find-match highlights', () => {
  const colors = buildNetcattyMonacoThemeColors(sampleColors);

  assert.equal(isSemiTransparentHex(colors['editor.findMatchBackground']), true);
  assert.equal(isSemiTransparentHex(colors['editor.findMatchHighlightBackground']), true);
  assert.equal(isSemiTransparentHex(colors['editor.findRangeHighlightBackground']), true);
  assert.equal(typeof colors['editorOverviewRuler.findMatchForeground'], 'string');
});

test('buildNetcattyMonacoThemeColors keeps current find match more visible than others', () => {
  const colors = buildNetcattyMonacoThemeColors(sampleColors);
  const currentAlpha = parseInt(colors['editor.findMatchBackground'].slice(-2), 16);
  const otherAlpha = parseInt(colors['editor.findMatchHighlightBackground'].slice(-2), 16);
  const rangeAlpha = parseInt(colors['editor.findRangeHighlightBackground'].slice(-2), 16);

  assert.ok(currentAlpha > otherAlpha);
  assert.ok(otherAlpha > rangeAlpha);
});

test('buildNetcattyMonacoThemeColors still maps core editor chrome from app colors', () => {
  const colors = buildNetcattyMonacoThemeColors(sampleColors);

  assert.equal(colors['editor.background'], sampleColors.bg);
  assert.equal(colors['editor.foreground'], sampleColors.fg);
  assert.equal(colors['editorCursor.foreground'], sampleColors.primary);
  assert.equal(colors['editor.selectionBackground'], `${sampleColors.primary}40`);
});

test('buildNetcattyMonacoThemeColors softens matching bracket highlight', () => {
  const colors = buildNetcattyMonacoThemeColors(sampleColors);

  assert.equal(colors['editorBracketMatch.background'], `${sampleColors.primary}14`);
  assert.equal(colors['editorBracketMatch.border'], `${sampleColors.primary}40`);
  assert.equal(colors['editor.selectionBackground'], `${sampleColors.primary}40`);
});
