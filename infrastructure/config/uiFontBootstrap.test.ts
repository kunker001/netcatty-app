import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/**
 * Regression for #2647: Windows boot CSS used a higher-specificity
 * `html.platform-win32 body { font-family: ... }` rule that beat
 * `body { font-family: var(--font-sans) }` from index.css. Popovers /
 * context menus inherit from body, so transfer / sync / quick-control
 * panels and menu items ignored the Appearance UI font setting.
 */
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

describe('index.html UI font bootstrap', () => {
  it('applies the runtime --font-sans variable on body', () => {
    assert.match(
      indexHtml,
      /body\s*\{[^}]*font-family:\s*var\(--font-sans\)/s,
      'body must use var(--font-sans) so Appearance UI font updates reach portaled panels',
    );
  });

  it('does not hardcode a Windows body font stack that overrides --font-sans', () => {
    assert.doesNotMatch(
      indexHtml,
      /html\.platform-win32\s+body\s*\{[^}]*font-family:/s,
      'platform-win32 must not set body font-family; emoji fallbacks belong on --font-sans',
    );
    assert.doesNotMatch(
      indexHtml,
      /body\s*\{[^}]*font-family:\s*['"]Space Grotesk['"]/s,
      'body must not hardcode Space Grotesk ahead of the user UI font setting',
    );
  });
});
