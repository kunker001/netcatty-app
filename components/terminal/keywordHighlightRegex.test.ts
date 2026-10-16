import test from "node:test";
import assert from "node:assert/strict";

import { forEachNonEmptyRe2Match, forEachNonEmptyRegexMatch } from "./keywordHighlightRegex.ts";

test("forEachNonEmptyRegexMatch returns normal consuming matches", () => {
  const regex = /\bfoo\b/gi;
  const indices: number[] = [];

  forEachNonEmptyRegexMatch(regex, "foo bar foo", (match) => {
    indices.push(match.index);
  });

  assert.deepEqual(indices, [0, 8]);
});

test("forEachNonEmptyRegexMatch skips zero-width matches without looping forever", () => {
  const regex = /(?=foo)/g;
  const indices: number[] = [];

  forEachNonEmptyRegexMatch(regex, "foo foo", (match) => {
    indices.push(match.index);
  });

  assert.deepEqual(indices, []);
});

test("forEachNonEmptyRegexMatch resets reused regex state before scanning", () => {
  const regex = /\d+/g;
  const indices: number[] = [];

  regex.lastIndex = 99;
  forEachNonEmptyRegexMatch(regex, "1 22 333", (match) => {
    indices.push(match.index);
  });

  assert.deepEqual(indices, [0, 2, 5]);
});

test("forEachNonEmptyRe2Match returns global case-insensitive UTF-16 ranges", () => {
  const ranges: Array<[number, number]> = [];
  forEachNonEmptyRe2Match("foo+", "x😀FOO yfoo", (start, length) => {
    ranges.push([start, length]);
  });
  assert.deepEqual(ranges, [[3, 3], [8, 3]]);
});

test("forEachNonEmptyRe2Match rejects expressions outside RE2", () => {
  assert.throws(() => forEachNonEmptyRe2Match("(a)\\1", "aa", () => {}));
});
