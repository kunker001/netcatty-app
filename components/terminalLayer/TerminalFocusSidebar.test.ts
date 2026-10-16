import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./TerminalFocusSidebar.tsx', import.meta.url), 'utf8');

test('focus sidebar row memo refreshes when dynamic title mode changes', () => {
  assert.match(source, /prev\.dynamicTabTitleMode === next\.dynamicTabTitleMode/);
});

test('focus sidebar accepts host-id drops for append-to-workspace', () => {
  assert.match(source, /onAppendHostToWorkspace/);
  assert.match(source, /resolveFocusSidebarDragKind/);
  assert.match(source, /appendHostFromWorkspaceDrop/);
  assert.match(source, /dropEffect = 'copy'/);
  assert.match(source, /data-host-drop-active/);
});

test('the entire focus sidebar is the host drop target', () => {
  const sidebarStart = source.indexOf('data-section="terminal-workspace-sidebar"');
  const scrollAreaStart = source.indexOf('<ScrollArea className="flex-1">', sidebarStart);
  assert.ok(sidebarStart >= 0 && scrollAreaStart > sidebarStart);

  const sidebarOpeningTag = source.slice(sidebarStart, scrollAreaStart);
  assert.match(sidebarOpeningTag, /data-focus-sidebar-drop-zone/);
  assert.match(sidebarOpeningTag, /onDragOver=\{handleFocusSidebarHostDragOver\}/);
  assert.match(sidebarOpeningTag, /onDrop=\{handleFocusSidebarHostDrop\}/);
  assert.doesNotMatch(source.slice(scrollAreaStart), /\sdata-focus-sidebar-drop-zone(?:\s|>)/);
});

test('focus sidebar clears host-drop feedback when the drag leaves from a session row', () => {
  assert.match(source, /data-focus-sidebar-drop-zone/);
  assert.match(source, /onDragLeave=\{handleFocusSidebarHostDragLeave\}/);
  assert.match(source, /onHostDragLeave=\{handleFocusSidebarHostDragLeave\}/);
  assert.match(source, /dropZone\?\.contains\(next\)/);
  assert.match(source, /clearFocusSidebarHostDrop\(\)/);
});
