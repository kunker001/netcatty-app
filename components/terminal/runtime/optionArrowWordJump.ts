export interface OptionArrowKeyEvent {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * macOS Option+←/→ word-jump (discussion #826).
 *
 * When enabled, maps a bare Option+Left/Right to the Meta-b / Meta-f sequence so
 * readline/zle does backward-word / forward-word without per-host bindkey setup.
 * Returns the bytes to send, or null when the mapping doesn't apply (disabled,
 * non-macOS, not an arrow, or other modifiers held) — in which case xterm's
 * default ^[[1;3D / ^[[1;3C is left untouched.
 *
 * Gated to macOS (`isMac`): the setting is syncable, so without the gate,
 * enabling it on a Mac would also rewrite Alt+←/→ on synced Linux/Windows
 * devices (discussion #826 review).
 */
export function optionArrowWordJumpSequence(
  e: OptionArrowKeyEvent,
  enabled: boolean,
  isMac: boolean,
): string | null {
  if (!enabled || !isMac) return null;
  // Only a bare Option+Arrow — leave Shift/Ctrl/Cmd combos to xterm's defaults.
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (e.key === "ArrowLeft") return "\x1bb"; // Meta-b → backward-word
  if (e.key === "ArrowRight") return "\x1bf"; // Meta-f → forward-word
  return null;
}
