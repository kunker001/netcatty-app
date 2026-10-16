import assert from 'node:assert/strict';
import test from 'node:test';

import { buildNumberShortcutTabTargets, buildTabShortcutNumberById } from './tabShortcutTargets.ts';

test('number shortcut tabs include vault and sftp by default', () => {
  assert.deepEqual(
    buildNumberShortcutTabTargets({
      showSftpTab: true,
      shellOnlyTabNumberShortcuts: false,
      orderedTabs: ['session-1', 'workspace-1'],
      editorTabIds: ['editor:file-1'],
    }),
    ['vault', 'sftp', 'session-1', 'workspace-1', 'editor:file-1'],
  );
});

test('number shortcut tabs skip vault and sftp when shell-only mode is enabled', () => {
  assert.deepEqual(
    buildNumberShortcutTabTargets({
      showSftpTab: true,
      shellOnlyTabNumberShortcuts: true,
      orderedTabs: ['session-1', 'workspace-1'],
      editorTabIds: ['editor:file-1'],
    }),
    ['session-1', 'workspace-1', 'editor:file-1'],
  );
});

test('hidden sftp tab is omitted from default number shortcut targets', () => {
  assert.deepEqual(
    buildNumberShortcutTabTargets({
      showSftpTab: false,
      shellOnlyTabNumberShortcuts: false,
      orderedTabs: ['session-1'],
      editorTabIds: [],
    }),
    ['vault', 'session-1'],
  );
});

test('editor tabs already present in native ordering are not appended twice', () => {
  assert.deepEqual(
    buildNumberShortcutTabTargets({
      showSftpTab: true,
      shellOnlyTabNumberShortcuts: false,
      orderedTabs: ['session-1', 'editor:file-1', 'plugin-view:one'],
      editorTabIds: ['editor:file-1'],
    }),
    ['vault', 'sftp', 'session-1', 'editor:file-1', 'plugin-view:one'],
  );
});

test('pinned tabs cannot be duplicated by a malformed persisted work ordering', () => {
  assert.deepEqual(
    buildNumberShortcutTabTargets({
      showSftpTab: true,
      shellOnlyTabNumberShortcuts: false,
      orderedTabs: ['vault', 'session-1', 'sftp'],
      editorTabIds: [],
    }),
    ['vault', 'sftp', 'session-1'],
  );
});

test('shortcut number map uses 1-based indices matching Ctrl/Cmd+[1...9]', () => {
  const map = buildTabShortcutNumberById({
    showSftpTab: true,
    shellOnlyTabNumberShortcuts: false,
    orderedTabs: ['session-1', 'workspace-1'],
    editorTabIds: [],
  });
  assert.equal(map.get('vault'), 1);
  assert.equal(map.get('sftp'), 2);
  assert.equal(map.get('session-1'), 3);
  assert.equal(map.get('workspace-1'), 4);
});

test('shortcut number map skips pinned tabs in shell-only mode', () => {
  const map = buildTabShortcutNumberById({
    showSftpTab: true,
    shellOnlyTabNumberShortcuts: true,
    orderedTabs: ['session-1', 'workspace-1'],
    editorTabIds: [],
  });
  assert.equal(map.has('vault'), false);
  assert.equal(map.has('sftp'), false);
  assert.equal(map.get('session-1'), 1);
  assert.equal(map.get('workspace-1'), 2);
});

test('shortcut number map caps at nine entries', () => {
  const orderedTabs = Array.from({ length: 12 }, (_, index) => `session-${index + 1}`);
  const map = buildTabShortcutNumberById({
    showSftpTab: false,
    shellOnlyTabNumberShortcuts: true,
    orderedTabs,
    editorTabIds: [],
  });
  assert.equal(map.size, 9);
  assert.equal(map.get('session-1'), 1);
  assert.equal(map.get('session-9'), 9);
  assert.equal(map.has('session-10'), false);
});
