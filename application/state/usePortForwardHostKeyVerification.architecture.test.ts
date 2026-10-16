import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./usePortForwardHostKeyVerification.ts", import.meta.url), "utf8");

test("usePortForwardHostKeyVerification stays below the UI layer", () => {
  assert.doesNotMatch(source, /from ["'].*components\//);
  assert.match(source, /from ["']\.\.\/\.\.\/domain\/portForwardHostKey["']/);
});
