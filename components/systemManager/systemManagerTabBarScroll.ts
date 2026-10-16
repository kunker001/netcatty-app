/** Edge buffer so an active tab is not stuck flush against the clip edge. */
const TAB_COMFORT_EDGE_RATIO = 0.28;
const TAB_COMFORT_EDGE_MIN = 28;
const TAB_COMFORT_EDGE_MAX = 72;

export const SYSTEM_MANAGER_TAB_BAR_ICON_ONLY_CLASS = 'system-manager-tab-bar--icon-only';

/** Quiet period after resize before re-evaluating icon-only (side-panel drag). */
export const SYSTEM_MANAGER_TAB_BAR_SETTLE_MS = 120;

/**
 * Extra room required before leaving icon-only. Keeps a small hysteresis without
 * locking the bar into permanent icon-only mode.
 */
export const SYSTEM_MANAGER_TAB_BAR_EXPAND_SLACK_PX = 8;

export type SystemManagerTabBarLabeledFit = {
  /** Labeled tabs need more width than the bar's inner budget. */
  overflows: boolean;
  /** Labeled tabs fit with expand slack — safe to show text again. */
  fitsWithSlack: boolean;
};

function readFlexGapPx(el: HTMLElement | null | undefined): number {
  if (!el) return 0;
  const style = getComputedStyle(el);
  const raw = style.columnGap || style.gap || '0';
  const value = parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Measure whether the *labeled* tab strip fits in the bar's current width.
 *
 * Important: do not use scrollWidth vs clientWidth for the "fits" check.
 * When content does not overflow, browsers often report scrollWidth === clientWidth,
 * so "fitsWithSlack" becomes permanently false and icon-only never exits.
 *
 * Instead: force labels on, sum real tab (and overflow) box widths, compare to
 * the bar's inner budget (clientWidth minus horizontal padding).
 */
export function measureSystemManagerTabBarLabeledFit(
  container: HTMLElement | null | undefined,
  expandSlackPx: number = SYSTEM_MANAGER_TAB_BAR_EXPAND_SLACK_PX,
): SystemManagerTabBarLabeledFit {
  if (!container) {
    return { overflows: false, fitsWithSlack: true };
  }

  const budget = container.clientWidth;
  // Hidden / zero-width host: do not pretend labels fit (that would drop
  // icon-only while the side panel is display:none or still laying out).
  if (budget <= 0) {
    return { overflows: false, fitsWithSlack: false };
  }

  const labelEls = Array.from(
    container.querySelectorAll<HTMLElement>('.system-manager-tab-label'),
  );
  const hadIconOnly = container.classList.contains(SYSTEM_MANAGER_TAB_BAR_ICON_ONLY_CLASS);
  const prevDisplay = labelEls.map((el) => el.style.display);

  try {
    if (hadIconOnly) {
      container.classList.remove(SYSTEM_MANAGER_TAB_BAR_ICON_ONLY_CLASS);
    }
    for (const el of labelEls) {
      // Force visible for measurement even if a stylesheet still hides them.
      el.style.display = 'inline';
    }
    void container.offsetWidth;

    const tabs = Array.from(container.querySelectorAll<HTMLElement>('.system-manager-tab'));
    let contentWidth = 0;
    for (const tab of tabs) {
      contentWidth += tab.getBoundingClientRect().width;
    }

    const row = tabs[0]?.parentElement ?? null;
    const gap = readFlexGapPx(row);
    if (tabs.length > 1) {
      contentWidth += gap * (tabs.length - 1);
    }

    const overflow = container.querySelector<HTMLElement>(
      '[data-section="system-manager-tab-overflow"]',
    );
    if (overflow) {
      const overflowWidth = overflow.getBoundingClientRect().width;
      if (overflowWidth > 0.5) {
        contentWidth += overflowWidth + (tabs.length > 0 ? gap : 0);
      }
    }

    const style = getComputedStyle(container);
    const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    // clientWidth includes padding; children lay out in the content box.
    const available = Math.max(0, budget - padX);

    return {
      overflows: contentWidth > available + 1,
      fitsWithSlack: contentWidth + expandSlackPx <= available,
    };
  } finally {
    labelEls.forEach((el, i) => {
      el.style.display = prevDisplay[i] ?? '';
    });
    if (hadIconOnly) {
      container.classList.add(SYSTEM_MANAGER_TAB_BAR_ICON_ONLY_CLASS);
    }
  }
}

/**
 * Enter icon-only as soon as labels overflow; leave only when they fit with slack.
 */
export function resolveSystemManagerTabBarIconOnly(
  fit: SystemManagerTabBarLabeledFit,
  currentlyIconOnly: boolean,
): boolean {
  if (currentlyIconOnly) {
    return !fit.fitsWithSlack;
  }
  return fit.overflows;
}

/**
 * Scroll a system-manager sub-tab into a comfortable position inside its
 * horizontal tab bar. Uses container.scrollTo so nested panels are not
 * scrolled by element.scrollIntoView.
 */
export function scrollSystemManagerTabIntoView(
  container: HTMLElement | null | undefined,
  tab: HTMLElement | null | undefined,
  behavior: ScrollBehavior = 'smooth',
): void {
  if (!container || !tab) return;
  if (container.scrollWidth <= container.clientWidth + 1) return;

  const containerRect = container.getBoundingClientRect();
  const tabRect = tab.getBoundingClientRect();
  const edgeBuffer = Math.min(
    TAB_COMFORT_EDGE_MAX,
    Math.max(TAB_COMFORT_EDGE_MIN, containerRect.width * TAB_COMFORT_EDGE_RATIO),
  );

  const overflowsLeft = tabRect.left < containerRect.left + edgeBuffer;
  const overflowsRight = tabRect.right > containerRect.right - edgeBuffer;
  if (!overflowsLeft && !overflowsRight) return;

  const tabCenter =
    tabRect.left - containerRect.left + container.scrollLeft + tabRect.width / 2;
  const maxScrollLeft = container.scrollWidth - container.clientWidth;
  const targetLeft = Math.max(
    0,
    Math.min(maxScrollLeft, tabCenter - container.clientWidth / 2),
  );

  if (Math.abs(container.scrollLeft - targetLeft) < 1) return;
  container.scrollTo({ left: targetLeft, behavior });
}

/**
 * Map a wheel event onto horizontal scrollLeft. Vertical mouse wheel becomes
 * left/right motion when the bar overflows.
 *
 * Returns true when the event was consumed (caller should preventDefault).
 */
export function applyHorizontalWheelToScrollContainer(
  container: HTMLElement,
  event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>,
): boolean {
  if (container.scrollWidth <= container.clientWidth + 1) return false;

  // Prefer non-zero deltaX so trackpads that emit both axes feel natural.
  const rawDelta = event.deltaX !== 0 ? event.deltaX : event.deltaY;
  if (rawDelta === 0) return false;

  // deltaMode: 0 = pixels, 1 = lines, 2 = pages
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientWidth : 1;
  const delta = rawDelta * scale;
  const maxScrollLeft = container.scrollWidth - container.clientWidth;
  const next = Math.max(0, Math.min(maxScrollLeft, container.scrollLeft + delta));
  if (next === container.scrollLeft) return false;

  container.scrollLeft = next;
  return true;
}
