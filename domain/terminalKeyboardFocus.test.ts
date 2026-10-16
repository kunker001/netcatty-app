import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldClaimTerminalKeyboardFocus } from './terminalKeyboardFocus.ts';

type FakeNode = {
  classList?: { contains: (name: string) => boolean };
  closest: (selector: string) => FakeNode | null;
  type?: string;
  isContentEditable?: boolean;
};

function withClosest(
  match: (selector: string) => boolean,
  extras: Partial<FakeNode> = {},
): FakeNode {
  return {
    closest: (selector: string) => (match(selector) ? withClosest(() => true) : null),
    ...extras,
  };
}

test('claims focus when nothing meaningful is focused', () => {
  assert.equal(shouldClaimTerminalKeyboardFocus(null), true);
});

test('does not steal focus from AI side panel textarea', () => {
  const textarea = withClosest((sel) => sel === '[data-section="ai-chat-panel"]');
  Object.setPrototypeOf(textarea, { constructor: { name: 'HTMLTextAreaElement' } });
  // instanceof HTMLTextAreaElement fails without DOM — exercise data-section path only.
  assert.equal(shouldClaimTerminalKeyboardFocus(textarea as unknown as Element), false);
});

test('does not steal focus from terminal side panel shell', () => {
  const input = withClosest((sel) => sel === '[data-section="terminal-side-panel"]');
  assert.equal(shouldClaimTerminalKeyboardFocus(input as unknown as Element), false);
});

test('claims focus when active element is xterm helper textarea outside side panel', () => {
  // Without DOM, HTMLTextAreaElement instanceof checks are false — so a plain
  // element with no side-panel closest() is claimable.
  const xterm = withClosest(() => false, {
    classList: { contains: (name) => name === 'xterm-helper-textarea' },
  });
  assert.equal(shouldClaimTerminalKeyboardFocus(xterm as unknown as Element), true);
});
