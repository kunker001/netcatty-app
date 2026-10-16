/**
 * Incomplete terminal control strings are normally tiny. A missing terminator
 * must not make every later chunk retain and rescan an ever-growing prefix.
 */
export const MAX_INCOMPLETE_TERMINAL_CONTROL_SEQUENCE_CHARS = 64 * 1024;

export const canRetainIncompleteTerminalControlSequence = (value: string): boolean => (
  value.length <= MAX_INCOMPLETE_TERMINAL_CONTROL_SEQUENCE_CHARS
);
