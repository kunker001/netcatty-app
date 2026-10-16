import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CURSOR_LINE_HIGHLIGHT_BLEND,
  ensureCursorLineHighlightContrast,
  resolveCursorLineHighlightBackground,
} from './cursorLineHighlight.ts';

test('resolveCursorLineHighlightBackground mixes the selection with the theme background', () => {
  const color = resolveCursorLineHighlightBackground({
    background: '#0d1117',
    foreground: '#c9d1d9',
    selection: '#264f78',
  });
  assert.equal(color, '#1b334c');
});

test('resolveCursorLineHighlightBackground falls back to foreground when selection is invalid', () => {
  const withSelection = resolveCursorLineHighlightBackground({
    background: '#000000',
    foreground: '#ffffff',
    selection: '#808080',
  });
  const withoutSelection = resolveCursorLineHighlightBackground({
    background: '#000000',
    foreground: '#ffffff',
    selection: 'not-a-color',
  });
  assert.equal(withSelection, '#464646');
  assert.equal(withoutSelection, '#707070');
});

test('resolveCursorLineHighlightBackground expands short hex and strips alpha', () => {
  const short = resolveCursorLineHighlightBackground({
    background: '#000',
    foreground: '#fff',
    selection: '#88888888',
  });
  assert.equal(short, '#4b4b4b');
});

test('CURSOR_LINE_HIGHLIGHT_BLEND stays a visible fraction', () => {
  assert.ok(CURSOR_LINE_HIGHLIGHT_BLEND > 0 && CURSOR_LINE_HIGHLIGHT_BLEND < 1);
});

test('resolveCursorLineHighlightBackground keeps white text readable', () => {
  const color = resolveCursorLineHighlightBackground({
    background: '#0d1117',
    foreground: '#ffffff',
    selection: '#ffffff',
  });
  const channel = Number.parseInt(color.slice(1, 3), 16) / 255;
  const luminance = channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  assert.ok((1.05) / (luminance + 0.05) >= 4.5);
});

test('resolveCursorLineHighlightBackground repairs a low-contrast light theme', () => {
  assert.equal(
    resolveCursorLineHighlightBackground({
      background: '#f0f0f0',
      foreground: '#888888',
      selection: '#ffffff',
    }),
    '#000000',
  );
});

test('ensureCursorLineHighlightContrast protects keyword blue', () => {
  assert.equal(
    ensureCursorLineHighlightContrast('#1b334c', ['#3b82f6']),
    '#000000',
  );
});

test('resolveCursorLineHighlightBackground keeps Tokyo Night Light visible', () => {
  assert.notEqual(
    resolveCursorLineHighlightBackground({
      background: '#e1e2e7',
      foreground: '#3760bf',
      selection: '#abc7d4',
    }),
    '#e1e2e7',
  );
});
