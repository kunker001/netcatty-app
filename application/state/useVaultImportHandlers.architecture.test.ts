import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./useVaultImportHandlers.ts", import.meta.url), "utf8");

test("useVaultImportHandlers stays below the UI layer", () => {
  assert.doesNotMatch(source, /from ["'].*components\//);
  assert.doesNotMatch(source, /from ["'].*\/toast["']/);
  assert.match(source, /notify: VaultImportNotifier/);
  assert.match(source, /from ["']\.\/vaultImportOptions["']/);
});
