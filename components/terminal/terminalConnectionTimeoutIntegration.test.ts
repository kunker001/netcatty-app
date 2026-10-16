import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const terminalSource = readFileSync(new URL("../Terminal.tsx", import.meta.url), "utf8");

test("direct terminal sessions reuse a stable empty jump-host list", () => {
  assert.match(terminalSource, /const EMPTY_CHAIN_HOSTS: Host\[\] = \[\]/);
  assert.match(terminalSource, /chainHosts = EMPTY_CHAIN_HOSTS/);
  assert.doesNotMatch(terminalSource, /chainHosts = \[\]/);
});
