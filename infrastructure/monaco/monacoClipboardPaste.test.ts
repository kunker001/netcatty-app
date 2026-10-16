import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMonacoPasteEdits,
  isMonacoFindWidgetFocused,
  isStillFocusedFindPasteTarget,
  pasteForMonacoEditorCommand,
  pasteTextIntoFocusedInput,
  readClipboardTextWithFallbacks,
  type FocusedTextInput,
} from './monacoClipboardPaste.ts';

function createMockTextInput(initialValue = ''): FocusedTextInput & {
  selectionStart: number;
  selectionEnd: number;
} {
  let selectionStart = initialValue.length;
  let selectionEnd = initialValue.length;
  return {
    value: initialValue,
    get selectionStart() {
      return selectionStart;
    },
    set selectionStart(value: number) {
      selectionStart = value;
    },
    get selectionEnd() {
      return selectionEnd;
    },
    set selectionEnd(value: number) {
      selectionEnd = value;
    },
    focus() {},
    setSelectionRange(start: number, end: number) {
      selectionStart = start;
      selectionEnd = end;
    },
  };
}

test('buildMonacoPasteEdits pastes full text at a single cursor', () => {
  const edits = buildMonacoPasteEdits('hello\nworld', [
    { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
  ]);
  assert.deepEqual(edits, [
    {
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
      text: 'hello\nworld',
      forceMoveMarkers: true,
    },
  ]);
});

test('buildMonacoPasteEdits spreads one line per cursor when counts match', () => {
  const edits = buildMonacoPasteEdits('one\ntwo', [
    { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
    { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 1 },
  ]);
  assert.equal(edits.length, 2);
  assert.equal(edits[0]?.text, 'one');
  assert.equal(edits[1]?.text, 'two');
});

test('buildMonacoPasteEdits does not spread when line and cursor counts differ', () => {
  const edits = buildMonacoPasteEdits('only-one-line', [
    { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
    { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 1 },
  ]);
  assert.equal(edits[0]?.text, 'only-one-line');
  assert.equal(edits[1]?.text, 'only-one-line');
});

test('buildMonacoPasteEdits returns empty when there are no selections', () => {
  assert.deepEqual(buildMonacoPasteEdits('text', []), []);
});

test('readClipboardTextWithFallbacks prefers navigator clipboard', async () => {
  const text = await readClipboardTextWithFallbacks({
    readNavigator: async () => 'from-navigator',
    readBridge: async () => {
      throw new Error('bridge should not run');
    },
  });
  assert.equal(text, 'from-navigator');
});

test('readClipboardTextWithFallbacks uses bridge when navigator fails', async () => {
  const text = await readClipboardTextWithFallbacks({
    readNavigator: async () => {
      throw new Error('denied');
    },
    readBridge: async () => 'from-bridge',
  });
  assert.equal(text, 'from-bridge');
});

test('readClipboardTextWithFallbacks returns null when both paths fail', async () => {
  const text = await readClipboardTextWithFallbacks({
    readNavigator: async () => {
      throw new Error('denied');
    },
    readBridge: async () => {
      throw new Error('unavailable');
    },
  });
  assert.equal(text, null);
});

test('isMonacoFindWidgetFocused detects elements inside .find-widget', () => {
  const findInput = {
    closest: (selector: string) => (selector === '.find-widget' ? {} : null),
  };
  const otherInput = {
    closest: () => null,
  };
  assert.equal(isMonacoFindWidgetFocused(findInput), true);
  assert.equal(isMonacoFindWidgetFocused(otherInput), false);
  assert.equal(isMonacoFindWidgetFocused(null), false);
});

test('pasteTextIntoFocusedInput replaces the current selection', () => {
  const input = createMockTextInput('hello');
  input.setSelectionRange(0, 5);
  assert.equal(pasteTextIntoFocusedInput(input, 'world'), true);
  assert.equal(input.value, 'world');
  assert.equal(input.selectionStart, 5);
  assert.equal(input.selectionEnd, 5);
});

test('pasteTextIntoFocusedInput rejects non-input targets', () => {
  assert.equal(pasteTextIntoFocusedInput({ closest: () => ({}) }, 'x'), false);
});

test('pasteForMonacoEditorCommand pastes into find widget and skips editor body', async () => {
  const input = Object.assign(createMockTextInput(''), {
    closest: (selector: string) => (selector === '.find-widget' ? {} : null),
  });
  let bodyPasteCount = 0;
  await pasteForMonacoEditorCommand({
    activeElement: input,
    readClipboardText: async () => 'search-me',
    pasteIntoEditor: () => {
      bodyPasteCount += 1;
    },
  });

  assert.equal(input.value, 'search-me');
  assert.equal(bodyPasteCount, 0);
});

test('pasteForMonacoEditorCommand falls through to editor body outside find widget', async () => {
  let bodyPasteCount = 0;
  await pasteForMonacoEditorCommand({
    activeElement: null,
    readClipboardText: async () => {
      throw new Error('should not read clipboard for body path');
    },
    pasteIntoEditor: () => {
      bodyPasteCount += 1;
    },
  });
  assert.equal(bodyPasteCount, 1);
});

test('isStillFocusedFindPasteTarget rejects targets no longer inside the find widget', () => {
  const leftFind = {
    closest: () => null,
  };
  assert.equal(isStillFocusedFindPasteTarget(leftFind), false);
  assert.equal(isStillFocusedFindPasteTarget(null), false);
});

test('pasteForMonacoEditorCommand aborts if focus leaves the find field mid clipboard read', async () => {
  const input = Object.assign(createMockTextInput('keep'), {
    closest: (selector: string) => (selector === '.find-widget' ? {} : null),
  });
  // Simulate a browser document where focus moved away during the await.
  const previousDocument = (globalThis as { document?: Document }).document;
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { activeElement: { id: 'editor-body' } },
  });

  let bodyPasteCount = 0;
  try {
    await pasteForMonacoEditorCommand({
      activeElement: input,
      readClipboardText: async () => 'should-not-apply',
      pasteIntoEditor: () => {
        bodyPasteCount += 1;
      },
    });
  } finally {
    if (previousDocument === undefined) {
      delete (globalThis as { document?: Document }).document;
    } else {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: previousDocument,
      });
    }
  }

  assert.equal(input.value, 'keep');
  assert.equal(bodyPasteCount, 0);
});
