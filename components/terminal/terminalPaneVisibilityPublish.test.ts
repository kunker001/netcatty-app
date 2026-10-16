import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("TerminalPane publishes visibility before paint", () => {
  const source = readFileSync(
    new URL("../terminalLayer/TerminalLayerSupport.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /useLayoutEffect\(\(\) => \{\s*setPaneVisible\(session\.id, isVisible\);\s*\}, \[session\.id, isVisible\]\);/,
  );
  assert.doesNotMatch(
    source,
    /useEffect\(\(\) => \{\s*setPaneVisible\(session\.id, isVisible\);\s*\}, \[session\.id, isVisible\]\);/,
  );
});
