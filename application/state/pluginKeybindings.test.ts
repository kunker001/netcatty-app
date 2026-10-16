import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isPluginShortcutEditableEvent,
  normalizePluginKeyboardEvent,
  normalizePluginShortcut,
  resolvePluginShortcutPlatform,
} from './pluginKeybindings';

function editableTarget(matcher: RegExp) {
  return {
    closest(selector: string) { return matcher.test(selector) ? this : null; },
  } as unknown as EventTarget;
}

test('plugin keybindings canonicalize aliases, named keys, and modifier order', () => {
  assert.equal(normalizePluginShortcut('Control + Space', 'linux'), 'ctrl+space');
  assert.equal(normalizePluginShortcut('Esc', 'linux'), 'escape');
  assert.equal(normalizePluginShortcut('Ctrl+Up', 'linux'), 'ctrl+arrowup');
  assert.equal(normalizePluginShortcut('Shift+Ctrl+P', 'linux'), 'ctrl+shift+p');
  assert.equal(normalizePluginShortcut('Mod+P', 'mac'), 'meta+p');
  assert.equal(normalizePluginShortcut('Mod+P', 'windows'), 'ctrl+p');
});

test('browser keyboard events use the same canonical shortcut representation', () => {
  assert.equal(normalizePluginKeyboardEvent({
    key: ' ', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false,
  }), 'ctrl+space');
  assert.equal(normalizePluginKeyboardEvent({
    key: 'Esc', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
  }), 'escape');
  assert.equal(normalizePluginKeyboardEvent({
    key: 'ArrowUp', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false,
  }), 'ctrl+arrowup');
  assert.equal(normalizePluginKeyboardEvent({
    key: '!', code: 'Digit1', metaKey: false, ctrlKey: false, altKey: false, shiftKey: true,
  }), 'shift+1');
});

test('plugin keybindings reject ambiguous declarations and resolve host platforms', () => {
  assert.equal(normalizePluginShortcut('Ctrl+Ctrl+P', 'linux'), null);
  assert.equal(normalizePluginShortcut('Ctrl+Meta+P', 'mac'), null);
  assert.equal(normalizePluginShortcut('P+Shift', 'linux'), null);
  assert.equal(resolvePluginShortcutPlatform('MacIntel'), 'mac');
  assert.equal(resolvePluginShortcutPlatform('Win32'), 'windows');
  assert.equal(resolvePluginShortcutPlatform('Linux x86_64'), 'linux');
});

test('plugin shortcuts are suppressed throughout editable and Monaco surfaces', () => {
  for (const matcher of [/\[contenteditable\]/u, /\[role="textbox"\]/u, /\.monaco-editor/u, /textarea/u]) {
    assert.equal(isPluginShortcutEditableEvent({ target: editableTarget(matcher) }), true);
  }
  assert.equal(isPluginShortcutEditableEvent({
    target: null,
    composedPath: () => [editableTarget(/\.monaco-inputbox/u)],
  }), true);
  assert.equal(isPluginShortcutEditableEvent({
    target: { closest: () => null } as unknown as EventTarget,
  }), false);
});
