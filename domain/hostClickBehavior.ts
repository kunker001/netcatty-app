/**
 * Vault host/group click activation.
 *
 * - `connect` (default): single click immediately connects / opens
 * - `select`: first click focuses; click the focused item again to activate
 */
export type HostClickBehavior = 'connect' | 'select';

export const DEFAULT_HOST_CLICK_BEHAVIOR: HostClickBehavior = 'connect';

export function isHostClickBehavior(value: unknown): value is HostClickBehavior {
  return value === 'connect' || value === 'select';
}

export function resolveHostActivateAction(input: {
  behavior: HostClickBehavior;
  isMultiSelectMode: boolean;
  focusedHostId: string | null | undefined;
  hostId: string;
}): 'connect' | 'select' | 'toggle-multi' {
  if (input.isMultiSelectMode) return 'toggle-multi';
  if (input.behavior === 'connect') return 'connect';
  if (input.focusedHostId === input.hostId) return 'connect';
  return 'select';
}

export function isHostClickFocusSelected(input: {
  behavior: HostClickBehavior;
  isMultiSelectMode: boolean;
  focusedHostId: string | null | undefined;
  hostId: string;
}): boolean {
  return (
    input.behavior === 'select'
    && !input.isMultiSelectMode
    && input.focusedHostId === input.hostId
  );
}

export function resolveGroupActivateAction(input: {
  behavior: HostClickBehavior;
  focusedGroupPath: string | null | undefined;
  groupPath: string;
}): 'open' | 'select' {
  if (input.behavior === 'connect') return 'open';
  if (input.focusedGroupPath === input.groupPath) return 'open';
  return 'select';
}

export function shouldClearHostFocusOnBackgroundClick(input: {
  behavior: HostClickBehavior;
  isMultiSelectMode: boolean;
  clickedWithinHostList: boolean;
  clickedHostOrGroup: boolean;
}): boolean {
  return (
    input.behavior === 'select' &&
    !input.isMultiSelectMode &&
    input.clickedWithinHostList &&
    !input.clickedHostOrGroup
  );
}

/**
 * Focus styles for vault host/group cards.
 * - Grid: recolor existing soft-card border to accent.
 * - List/tree: hover-like background fill only (no border).
 */
export function hostCardFocusClassName(
  viewMode: 'grid' | 'list' | 'tree',
  isFocused: boolean,
): string {
  if (!isFocused) return '';
  // Grid soft-card already draws a border; force accent color (beat .soft-card).
  if (viewMode === 'grid') {
    return '!border-primary';
  }
  // List/tree: same glass fill as hover — no border.
  return 'bg-secondary/60';
}
