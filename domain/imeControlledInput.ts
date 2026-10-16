/**
 * Pure helpers for controlled text inputs that must not fight CJK IME composition.
 *
 * Deferred parent updates (e.g. startTransition) against `value={external}` reset
 * the DOM mid-composition and break Windows IMEs (candidate dismiss / pinyin echo).
 */

export function shouldCommitImeControlledChange(input: {
  isComposingSession: boolean;
  nativeEventIsComposing?: boolean;
  /**
   * When true, the open (or just-ended) composition was discarded by an external
   * value change (e.g. navigation cleared the filter). Suppress commits so a
   * post-compositionend `onChange` cannot reassert the stale composed draft.
   */
  compositionExternallySuperseded?: boolean;
}): boolean {
  if (input.compositionExternallySuperseded) return false;
  return !input.isComposingSession && input.nativeEventIsComposing !== true;
}

export function shouldAdoptExternalImeControlledValue(input: {
  isComposingSession: boolean;
  draftValue: string;
  externalValue: string;
  /**
   * Committed external value captured at compositionstart. When provided during
   * an open composition, an external change relative to this baseline (e.g.
   * different-directory navigation setting filter to "") supersedes the draft
   * so compositionend cannot re-commit stale text over the navigation clear.
   */
  valueAtComposeStart?: string;
}): boolean {
  if (input.draftValue === input.externalValue) return false;
  if (!input.isComposingSession) return true;
  // Mid-composition: only adopt when parent moved away from the compose-start
  // baseline. Without a baseline, never fight the IME for self-driven drafts.
  if (input.valueAtComposeStart !== undefined) {
    return input.externalValue !== input.valueAtComposeStart;
  }
  return false;
}

/**
 * Resolve an input event when a composition may have been externally superseded
 * (navigation clear mid-IME). Browsers often re-fire the composed text via
 * `onChange` with `isComposing=false` immediately after `compositionend`; that
 * follow-up must not reassert the stale draft.
 *
 * - While still composing after supersede: keep ignoring event values (draft stays
 *   on the external value) and keep the latch armed.
 * - Once composition has fully ended: ignore that one post-composition change and
 *   clear the latch so subsequent ordinary typing commits normally.
 */
export function resolveSupersededImeInputEvent(input: {
  compositionExternallySuperseded: boolean;
  isComposingSession: boolean;
  nativeEventIsComposing?: boolean;
}): {
  ignoreEventValue: boolean;
  clearSupersedeLatch: boolean;
} {
  if (!input.compositionExternallySuperseded) {
    return { ignoreEventValue: false, clearSupersedeLatch: false };
  }
  const compositionFullyEnded =
    !input.isComposingSession && input.nativeEventIsComposing !== true;
  return {
    ignoreEventValue: true,
    clearSupersedeLatch: compositionFullyEnded,
  };
}
