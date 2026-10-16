import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./useSftpPaneSorting.ts", import.meta.url), "utf8");

test("useSftpPaneSorting imports column layout from application state", () => {
  assert.doesNotMatch(source, /from ["'].*components\//);
  assert.match(source, /from ["']\.\/columnLayout["']/);
});
