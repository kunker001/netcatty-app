/**
 * Shared Monaco paste helpers for Electron, where Monaco's built-in
 * clipboardPasteAction often cannot read the OS clipboard.
 */

export type MonacoPasteRange = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

export type MonacoPasteEdit = {
  range: MonacoPasteRange;
  text: string;
  forceMoveMarkers: true;
};

/**
 * Build executeEdits payloads matching Monaco multicursorPaste:'spread':
 * when cursor count equals clipboard line count, distribute one line per cursor.
 */
export function buildMonacoPasteEdits(
  text: string,
  selections: readonly MonacoPasteRange[],
): MonacoPasteEdit[] {
  if (selections.length === 0) return [];

  const lines = text.split(/\r\n|\n/);
  const distribute = selections.length > 1 && lines.length === selections.length;

  return selections.map((selection, i) => ({
    range: selection,
    text: distribute ? lines[i]! : text,
    forceMoveMarkers: true as const,
  }));
}

export type ClipboardTextReaders = {
  readNavigator?: () => Promise<string>;
  readBridge: () => Promise<string>;
};

/**
 * Prefer navigator.clipboard, then Electron bridge.
 * Returns null when both paths fail so callers can fall back to Monaco native paste.
 */
export async function readClipboardTextWithFallbacks(
  readers: ClipboardTextReaders,
): Promise<string | null> {
  if (readers.readNavigator) {
    try {
      return await readers.readNavigator();
    } catch {
      // Fall through to Electron bridge
    }
  }

  try {
    return await readers.readBridge();
  } catch {
    return null;
  }
}

type ClosableElement = {
  closest?: (selector: string) => unknown;
};

/** Editable text field shape used by Monaco find/replace inputs. */
export type FocusedTextInput = {
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  focus: () => void;
  setSelectionRange: (start: number, end: number) => void;
  dispatchEvent?: (event: Event) => boolean;
};

/** Monaco's find/replace overlay uses the `.find-widget` class. */
export function isMonacoFindWidgetFocused(
  active: ClosableElement | null | undefined,
): boolean {
  return Boolean(active?.closest?.('.find-widget'));
}

export function isFocusedTextInput(target: unknown): target is FocusedTextInput {
  if (typeof HTMLTextAreaElement !== 'undefined' && target instanceof HTMLTextAreaElement) {
    return true;
  }
  if (typeof HTMLInputElement !== 'undefined' && target instanceof HTMLInputElement) {
    return true;
  }
  if (!target || typeof target !== 'object') return false;
  const candidate = target as Partial<FocusedTextInput>;
  return typeof candidate.value === 'string'
    && typeof candidate.focus === 'function'
    && typeof candidate.setSelectionRange === 'function';
}

/**
 * Insert clipboard text into a focused find/replace input.
 * Custom Monaco Ctrl/Cmd+V commands steal the event, so the browser cannot
 * paste into the widget; we write the field ourselves instead of the body.
 */
export function pasteTextIntoFocusedInput(
  target: unknown,
  text: string,
): boolean {
  if (!isFocusedTextInput(target)) return false;

  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? target.value.length;
  target.focus();
  target.setSelectionRange(start, end);

  // insertText keeps undo/input events in supporting browsers.
  if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
    if (document.execCommand('insertText', false, text)) {
      return true;
    }
  }

  const nextValue = `${target.value.slice(0, start)}${text}${target.value.slice(end)}`;
  const nextCaret = start + text.length;
  target.value = nextValue;
  target.setSelectionRange(nextCaret, nextCaret);
  if (typeof target.dispatchEvent === 'function' && typeof Event !== 'undefined') {
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return true;
}

/**
 * After an async clipboard read, confirm the find input is still the live
 * focus target so we do not steal focus back into a closed/hidden widget or
 * paste via execCommand into a different field.
 */
export function isStillFocusedFindPasteTarget(
  active: ClosableElement | null | undefined,
): boolean {
  if (!active || !isMonacoFindWidgetFocused(active)) return false;

  if (typeof document !== 'undefined' && document.activeElement !== active) {
    return false;
  }

  if (
    typeof Element !== 'undefined'
    && active instanceof Element
    && 'isConnected' in active
    && !(active as Element).isConnected
  ) {
    return false;
  }

  return true;
}

/**
 * When focus is in Monaco's find widget, paste there; otherwise call body paste.
 * Used by Electron Ctrl/Cmd+V command handlers that override native paste.
 */
export async function pasteForMonacoEditorCommand(options: {
  activeElement: ClosableElement | null | undefined;
  readClipboardText: () => Promise<string | null>;
  pasteIntoEditor: () => void | Promise<void>;
}): Promise<void> {
  if (isMonacoFindWidgetFocused(options.activeElement)) {
    const active = options.activeElement;
    if (!active) return;
    try {
      const text = await options.readClipboardText();
      if (!text) return;
      // Clipboard I/O is async; abort if the user left the find field meanwhile.
      if (!isStillFocusedFindPasteTarget(active)) return;
      pasteTextIntoFocusedInput(active, text);
    } catch {
      // Clipboard or insert failed; leave the find field unchanged.
    }
    return;
  }
  await options.pasteIntoEditor();
}
