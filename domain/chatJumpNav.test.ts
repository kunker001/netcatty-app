import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChatJumpEntries,
  chatMessageDomId,
  resolveTailCountForJumpTarget,
  truncateChatJumpLabel,
} from './chatJumpNav.ts';

test('truncateChatJumpLabel collapses whitespace and ellipsizes', () => {
  assert.equal(truncateChatJumpLabel('  hello   world  '), 'hello world');
  assert.equal(
    truncateChatJumpLabel('a'.repeat(40), 10),
    `${'a'.repeat(7)}...`,
  );
  assert.equal(truncateChatJumpLabel('   '), '');
});

test('buildChatJumpEntries returns empty until the minimum user-turn threshold', () => {
  const messages = [
    { id: 'u1', role: 'user', content: 'one' },
    { id: 'a1', role: 'assistant', content: 'ok' },
    { id: 'u2', role: 'user', content: 'two' },
  ];
  assert.deepEqual(buildChatJumpEntries(messages), []);
  assert.equal(
    buildChatJumpEntries([
      ...messages,
      { id: 'u3', role: 'user', content: 'three' },
    ]).length,
    3,
  );
});

test('buildChatJumpEntries uses empty label fallback and skips non-user roles', () => {
  const entries = buildChatJumpEntries(
    [
      { id: 's', role: 'system', content: 'ignore' },
      { id: 'u1', role: 'user', content: '   ' },
      { id: 't', role: 'tool', content: 'tool' },
      { id: 'u2', role: 'user', content: 'second' },
      { id: 'u3', role: 'user', content: 'third' },
    ],
    { emptyLabel: '(empty)' },
  );
  assert.deepEqual(entries, [
    { messageId: 'u1', label: '(empty)', index: 1 },
    { messageId: 'u2', label: 'second', index: 2 },
    { messageId: 'u3', label: 'third', index: 3 },
  ]);
});

test('resolveTailCountForJumpTarget expands only when the target is outside the window', () => {
  const visible = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
  assert.equal(resolveTailCountForJumpTarget(visible, 'd', 2), 2);
  assert.equal(resolveTailCountForJumpTarget(visible, 'b', 2), 4);
  assert.equal(resolveTailCountForJumpTarget(visible, 'missing', 2), 2);
});

test('resolveTailCountForJumpTarget grows with appends so a pinned target stays mounted', () => {
  const before = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
  const afterJump = resolveTailCountForJumpTarget(before, 'b', 2);
  assert.equal(afterJump, 4);
  // slice(-4) on a longer list would drop 'b' unless the count is re-resolved.
  const afterAppend = [...before, { id: 'f' }, { id: 'g' }];
  assert.equal(resolveTailCountForJumpTarget(afterAppend, 'b', afterJump), 6);
});

test('chatMessageDomId prefixes message ids for DOM anchors', () => {
  assert.equal(chatMessageDomId('msg-12'), 'ai-chat-msg-msg-12');
});
