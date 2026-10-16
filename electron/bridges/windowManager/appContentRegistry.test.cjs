"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const windowManager = require("../windowManager.cjs");

function windowStub(id) {
  return {
    id,
    isDestroyed: () => false,
    webContents: {
      id,
      isCrashed: () => false,
      isDestroyed: () => false,
    },
  };
}

test("lifecycle-only app windows are excluded from dirty-editor queries", (context) => {
  const editorWindow = windowStub(101);
  const terminalPopup = windowStub(102);
  context.after(() => {
    windowManager.unregisterAppContentWindow(editorWindow);
    windowManager.unregisterAppContentWindow(terminalPopup);
  });

  windowManager.registerAppContentWindow(editorWindow, { queryDirtyEditors: true });
  windowManager.registerAppContentWindow(terminalPopup);

  assert.deepEqual(windowManager.getAppContentWindows(), [editorWindow, terminalPopup]);
  assert.deepEqual(windowManager.getDirtyEditorWindows(), [editorWindow]);
  windowManager.unregisterAppContentWindow(editorWindow);
  assert.deepEqual(windowManager.getAppContentWindows(), [terminalPopup]);
  assert.deepEqual(windowManager.getDirtyEditorWindows(), []);
});
