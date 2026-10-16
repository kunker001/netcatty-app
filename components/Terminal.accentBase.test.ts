import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./Terminal.tsx", import.meta.url), "utf8");

test("Terminal re-resolves catalog theme before applying store accent", () => {
  // appearanceTheme may still carry a baked custom accent while TerminalLayer
  // memo ignores accent churn. Switching accentMode back to `theme` must clear
  // cursor/selection by starting from the clean catalog theme id.
  assert.match(source, /useAppearanceChromeStore\(\)/);
  assert.match(
    source,
    /getBuiltinTerminalThemeById\(appearanceTheme\.id\)/,
  );
  assert.match(
    source,
    /applyCustomAccentToTerminalTheme\(resolveBase\(\), accentMode, customAccent\)/,
  );
  assert.doesNotMatch(
    source,
    /if \(appearanceTheme\) return appearanceTheme;/,
  );
});
