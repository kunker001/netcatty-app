import test from "node:test";
import assert from "node:assert/strict";

import { resolveSidePanelToggleIntent } from "./resolveSidePanelToggleIntent.ts";

test("open: closed with a remembered tab → open that tab", () => {
  const r = resolveSidePanelToggleIntent({ isOpen: false, lastTab: "sftp", fallbackTab: "scripts" });
  assert.deepEqual(r, { kind: "open", tab: "sftp" });
});

test("open: closed with no memory → open the fallback tab", () => {
  const r = resolveSidePanelToggleIntent({ isOpen: false, lastTab: null, fallbackTab: "scripts" });
  assert.deepEqual(r, { kind: "open", tab: "scripts" });
});

test("close: already open → close", () => {
  const r = resolveSidePanelToggleIntent({ isOpen: true, lastTab: "theme", fallbackTab: "sftp" });
  assert.deepEqual(r, { kind: "close" });
});
