/**
 * Decide whether terminal auto-focus may claim keyboard focus.
 *
 * Pane "isFocused" means workspace-focused session, not document.activeElement.
 * Auto-focus timers must not yank caret out of AI/SFTP/notes side-panel inputs.
 */

export function shouldClaimTerminalKeyboardFocus(
  activeElement: Element | null | undefined,
): boolean {
  const active = activeElement
    ?? (typeof document !== 'undefined' ? document.activeElement : null);
  if (
    !active
    || (typeof document !== 'undefined'
      && (active === document.body || active === document.documentElement))
  ) {
    return true;
  }

  // Whole side panel (AI / SFTP / History / Scripts / …)
  if (active.closest('[data-section="terminal-side-panel"]')) return false;
  if (active.closest('[data-section="ai-chat-panel"]')) return false;
  if (active.closest('[data-section="ai-chat-panel-preparing"]')) return false;
  if (active.closest('[data-section="ai-chat-panel-retained"]')) return false;

  // Non-xterm form controls elsewhere in the app chrome
  if (typeof HTMLTextAreaElement !== 'undefined'
    && active instanceof HTMLTextAreaElement
    && !active.classList.contains('xterm-helper-textarea')
  ) {
    return false;
  }
  if (typeof HTMLInputElement !== 'undefined' && active instanceof HTMLInputElement) {
    const type = (active.type || 'text').toLowerCase();
    if (type !== 'hidden' && type !== 'button' && type !== 'submit' && type !== 'reset') {
      return false;
    }
  }
  if (
    typeof HTMLElement !== 'undefined'
    && active instanceof HTMLElement
    && active.isContentEditable
  ) {
    return false;
  }

  return true;
}
