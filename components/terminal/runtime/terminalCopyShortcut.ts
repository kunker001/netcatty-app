type CopyShortcutKeyEvent = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey"
>;

function isPhysicalCKey(e: CopyShortcutKeyEvent): boolean {
  return e.key.toLowerCase() === "c" || e.code === "KeyC";
}

export function isPlainCtrlCInterruptChord(e: CopyShortcutKeyEvent): boolean {
  return e.ctrlKey
    && !e.shiftKey
    && !e.altKey
    && !e.metaKey
    && isPhysicalCKey(e);
}

/** macOS Cmd+C / Super+C — forward when there is no xterm selection. */
export function isPlainMetaCCopyChord(e: CopyShortcutKeyEvent): boolean {
  return e.metaKey
    && !e.ctrlKey
    && !e.shiftKey
    && !e.altKey
    && isPhysicalCKey(e);
}

/**
 * When copy matches with no xterm selection, pass the chord through instead of
 * consuming an empty clipboard write.
 *
 * - Ctrl+C → SIGINT (or Kitty Ctrl+C)
 * - Cmd+C → Kitty Super+C for nested TUIs (e.g. Herdr)
 *
 * Other no-selection copy bindings stay consumed as a safe no-op so keys like
 * F5 / Ctrl+L are not forwarded to the remote (#1461).
 */
export function shouldPassThroughCopyShortcut(
  action: string,
  hasSelection: boolean,
  e: CopyShortcutKeyEvent,
): boolean {
  return action === "copy"
    && !hasSelection
    && (isPlainCtrlCInterruptChord(e) || isPlainMetaCCopyChord(e));
}
