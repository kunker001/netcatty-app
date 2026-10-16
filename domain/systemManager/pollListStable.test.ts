import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { mergePollListByKey, nextPollData } from "./pollListStable.ts";

test("nextPollData reuses previous reference when payload is unchanged", () => {
  const prev = { a: 1 };
  assert.equal(nextPollData(prev, { a: 1 }), prev);
  assert.notEqual(nextPollData(prev, { a: 2 }), prev);
});

test("mergePollListByKey reuses unchanged row references", () => {
  const prev = [{ id: "1", v: 1 }, { id: "2", v: 2 }];
  const next = [{ id: "1", v: 1 }, { id: "2", v: 3 }];
  const merged = mergePollListByKey(prev, next, (item) => item.id);
  assert.equal(merged[0], prev[0]);
  assert.deepEqual(merged[1], { id: "2", v: 3 });
});

test("useSystemManager imports nextPollData from domain", () => {
  const source = readFileSync(
    new URL("../../application/state/useSystemManager.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /from ['"]\.\.\/\.\.\/domain\/systemManager\/pollListStable['"]/);
  assert.doesNotMatch(source, /from ['"].*components\//);
});
