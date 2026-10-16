import assert from "node:assert/strict";
import test from "node:test";

import { shouldDeferWebglUntilVisible } from "./webglRendererPolicy";

test("defers WebGL for a pane that mounts hidden", () => {
  assert.equal(
    shouldDeferWebglUntilVisible({ useWebGLAddon: true, initiallyVisible: false }),
    true,
  );
});

test("loads WebGL immediately for a visible pane (unchanged behavior)", () => {
  assert.equal(
    shouldDeferWebglUntilVisible({ useWebGLAddon: true, initiallyVisible: true }),
    false,
  );
});

test("never defers when WebGL is not used at all", () => {
  assert.equal(
    shouldDeferWebglUntilVisible({ useWebGLAddon: false, initiallyVisible: false }),
    false,
  );
  assert.equal(
    shouldDeferWebglUntilVisible({ useWebGLAddon: false, initiallyVisible: true }),
    false,
  );
});
