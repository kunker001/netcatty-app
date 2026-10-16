export interface TerminalAltKeyOptions {
  /** xterm.js: treat macOS Option as the Meta key (emit ESC-prefixed sequences). */
  macOptionIsMeta: boolean;
  /** xterm.js: Option+click moves the cursor. Must be off when Option is Meta. */
  altClickMovesCursor: boolean;
}

/**
 * Map the user's "Use Option as Meta key" setting to xterm.js options.
 *
 * Kept in one place so terminal init (createXTermRuntime) and the live settings
 * sync (Terminal.tsx) can't drift — that drift is what left `macOptionIsMeta`
 * unset everywhere and broke Option/Meta shortcuts on macOS (issue #1078).
 */
export function terminalAltKeyOptions(altAsMeta: boolean): TerminalAltKeyOptions {
  return {
    macOptionIsMeta: altAsMeta,
    altClickMovesCursor: !altAsMeta,
  };
}
