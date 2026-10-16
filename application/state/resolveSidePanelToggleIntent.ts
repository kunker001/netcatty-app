export type SidePanelToggleIntent<T extends string> =
  | { kind: 'close' }
  | { kind: 'open'; tab: T };

/**
 * Decide what the "toggle side panel" shortcut should do.
 * - If a panel is open → close it.
 * - If closed → reopen the last-shown sub-panel for the tab, falling back to
 *   `fallbackTab` when the tab has no remembered panel.
 */
export function resolveSidePanelToggleIntent<T extends string>(input: {
  isOpen: boolean;
  lastTab: T | null;
  fallbackTab: T;
}): SidePanelToggleIntent<T> {
  if (input.isOpen) return { kind: 'close' };
  return { kind: 'open', tab: input.lastTab ?? input.fallbackTab };
}
