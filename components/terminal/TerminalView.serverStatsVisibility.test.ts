import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("hidden terminal tabs stop server stats polling", () => {
  const source = readFileSync(new URL("./TerminalView.tsx", import.meta.url), "utf8");
  assert.match(
    source,
    /<TerminalServerStats[\s\S]*?enabled=\{\(terminalSettings\?\.showServerStats \?\? true\) && isVisible\}/,
  );
  assert.doesNotMatch(source, /shouldKeepTerminalBackgroundWorkActive/);
});
