import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./TerminalLayerWorkspaceSection.tsx", import.meta.url),
  "utf8",
);

test("workspace section uses live store only for activeWorkspace (no stale ctx fallback)", () => {
  // After view memo omits activeWorkspace from equality, ctx can lag behind
  // live when switching workspace → solo session (live clears to undefined).
  // `live.x ?? ctx.x` would keep the old workspace for compose bar / resizers.
  assert.match(source, /sidePanelLiveStore\.getSnapshot/);
  assert.match(source, /const activeWorkspace = live\.activeWorkspace;/);
  assert.match(source, /const focusedSessionId = live\.focusedSessionId;/);
  assert.doesNotMatch(source, /live\.activeWorkspace\s*\?\?/);
  assert.doesNotMatch(source, /live\.focusedSessionId\s*\?\?/);
  assert.doesNotMatch(source, /ctx\.activeWorkspace/);
  assert.doesNotMatch(source, /ctx\.focusedSessionId/);
  // Focus mode must follow live workspace, not stale ctx.isFocusMode.
  assert.match(source, /activeWorkspace\?\.viewMode === ['"]focus['"]/);
});
