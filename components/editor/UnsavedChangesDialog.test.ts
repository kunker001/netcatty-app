import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./UnsavedChangesDialog.tsx", import.meta.url), "utf8");

test("unsaved prompt singleton registers during render, not only in useEffect", () => {
  // AppView close / Cmd+W call promptUnsavedChanges outside the render-prop.
  // Assigning only in useEffect leaves a first-paint window where the
  // singleton is null and dirty closes silently resolve to "cancel".
  assert.match(source, /promptSingleton = prompt;/);
  assert.doesNotMatch(
    source,
    /useEffect\(\(\) => \{\s*promptSingleton = prompt;/,
  );
});
