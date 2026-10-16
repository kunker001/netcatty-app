import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyHorizontalWheelToScrollContainer,
  measureSystemManagerTabBarLabeledFit,
  resolveSystemManagerTabBarIconOnly,
  scrollSystemManagerTabIntoView,
  SYSTEM_MANAGER_TAB_BAR_EXPAND_SLACK_PX,
  SYSTEM_MANAGER_TAB_BAR_ICON_ONLY_CLASS,
} from './systemManagerTabBarScroll.ts';

function mockRect(left: number, width: number) {
  return {
    left,
    right: left + width,
    width,
    top: 0,
    bottom: 24,
    height: 24,
    x: left,
    y: 0,
    toJSON() {
      return this;
    },
  } as DOMRect;
}

test('scrollSystemManagerTabIntoView is a no-op when content fits', () => {
  const calls: Array<{ left: number; behavior?: ScrollBehavior }> = [];
  const container = {
    scrollWidth: 200,
    clientWidth: 200,
    scrollLeft: 0,
    getBoundingClientRect: () => mockRect(0, 200),
    scrollTo(options: { left: number; behavior?: ScrollBehavior }) {
      calls.push(options);
    },
  } as unknown as HTMLElement;
  const tab = {
    getBoundingClientRect: () => mockRect(20, 60),
  } as unknown as HTMLElement;

  scrollSystemManagerTabIntoView(container, tab);
  assert.equal(calls.length, 0);
});

test('applyHorizontalWheelToScrollContainer maps vertical wheel to horizontal scroll', () => {
  const container = {
    scrollWidth: 500,
    clientWidth: 200,
    scrollLeft: 0,
  } as unknown as HTMLElement;

  assert.equal(
    applyHorizontalWheelToScrollContainer(container, { deltaX: 0, deltaY: 40, deltaMode: 0 }),
    true,
  );
  assert.equal(container.scrollLeft, 40);
});

test('measureSystemManagerTabBarLabeledFit sums tab boxes (not scrollWidth===clientWidth trap)', () => {
  const label = { style: { display: 'none' } } as unknown as HTMLElement;
  const tabA = {
    getBoundingClientRect: () => mockRect(0, 80),
  } as unknown as HTMLElement;
  const tabB = {
    getBoundingClientRect: () => mockRect(82, 90),
  } as unknown as HTMLElement;
  const row = {
    // gap-0.5 ≈ 2px
  } as unknown as HTMLElement;
  Object.defineProperty(tabA, 'parentElement', { get: () => row });
  Object.defineProperty(tabB, 'parentElement', { get: () => row });

  const classList = {
    iconOnly: true,
    contains(name: string) {
      return name === SYSTEM_MANAGER_TAB_BAR_ICON_ONLY_CLASS && this.iconOnly;
    },
    remove(name: string) {
      if (name === SYSTEM_MANAGER_TAB_BAR_ICON_ONLY_CLASS) this.iconOnly = false;
    },
    add(name: string) {
      if (name === SYSTEM_MANAGER_TAB_BAR_ICON_ONLY_CLASS) this.iconOnly = true;
    },
  };

  // Wide panel: 400px budget, tabs total 80+90+2 = 172 → should fit.
  const container = {
    clientWidth: 400,
    offsetWidth: 400,
    classList,
    querySelectorAll(selector: string) {
      if (selector === '.system-manager-tab-label') {
        return [label, label] as unknown as NodeListOf<HTMLElement>;
      }
      if (selector === '.system-manager-tab') {
        return [tabA, tabB] as unknown as NodeListOf<HTMLElement>;
      }
      return [] as unknown as NodeListOf<HTMLElement>;
    },
    querySelector() {
      return null;
    },
  } as unknown as HTMLElement;

  // jsdom may not have getComputedStyle for gap/padding — stub global if needed.
  const originalGcs = globalThis.getComputedStyle;
  globalThis.getComputedStyle = ((el: Element) => {
    if (el === row) {
      return { columnGap: '2px', gap: '2px', paddingLeft: '0', paddingRight: '0' } as CSSStyleDeclaration;
    }
    if (el === container) {
      return { paddingLeft: '8px', paddingRight: '8px' } as CSSStyleDeclaration;
    }
    return originalGcs(el);
  }) as typeof getComputedStyle;

  try {
    const fit = measureSystemManagerTabBarLabeledFit(container, SYSTEM_MANAGER_TAB_BAR_EXPAND_SLACK_PX);
    // content 172, pad 16 → available 384 → fits
    assert.equal(fit.overflows, false);
    assert.equal(fit.fitsWithSlack, true);
    assert.equal(classList.iconOnly, true);
    assert.equal(label.style.display, 'none');
  } finally {
    globalThis.getComputedStyle = originalGcs;
  }
});

test('measureSystemManagerTabBarLabeledFit reports overflow when tabs exceed budget', () => {
  const label = { style: { display: '' } } as unknown as HTMLElement;
  const tabA = {
    getBoundingClientRect: () => mockRect(0, 200),
    parentElement: null as HTMLElement | null,
  } as unknown as HTMLElement;
  const tabB = {
    getBoundingClientRect: () => mockRect(0, 200),
    parentElement: null as HTMLElement | null,
  } as unknown as HTMLElement;
  const row = {} as HTMLElement;
  Object.defineProperty(tabA, 'parentElement', { get: () => row });
  Object.defineProperty(tabB, 'parentElement', { get: () => row });

  const classList = {
    contains: () => false,
    remove() {},
    add() {},
  };

  const container = {
    clientWidth: 300,
    offsetWidth: 300,
    classList,
    querySelectorAll(selector: string) {
      if (selector === '.system-manager-tab-label') {
        return [label] as unknown as NodeListOf<HTMLElement>;
      }
      if (selector === '.system-manager-tab') {
        return [tabA, tabB] as unknown as NodeListOf<HTMLElement>;
      }
      return [] as unknown as NodeListOf<HTMLElement>;
    },
    querySelector() {
      return null;
    },
  } as unknown as HTMLElement;

  const originalGcs = globalThis.getComputedStyle;
  globalThis.getComputedStyle = ((el: Element) => {
    if (el === row) {
      return { columnGap: '4px', gap: '4px', paddingLeft: '0', paddingRight: '0' } as CSSStyleDeclaration;
    }
    if (el === container) {
      return { paddingLeft: '0', paddingRight: '0' } as CSSStyleDeclaration;
    }
    return originalGcs(el);
  }) as typeof getComputedStyle;

  try {
    const fit = measureSystemManagerTabBarLabeledFit(container);
    // 200+200+4 = 404 > 300
    assert.equal(fit.overflows, true);
    assert.equal(fit.fitsWithSlack, false);
  } finally {
    globalThis.getComputedStyle = originalGcs;
  }
});

test('resolveSystemManagerTabBarIconOnly enters and leaves with hysteresis', () => {
  assert.equal(
    resolveSystemManagerTabBarIconOnly({ overflows: true, fitsWithSlack: false }, false),
    true,
  );
  assert.equal(
    resolveSystemManagerTabBarIconOnly({ overflows: false, fitsWithSlack: false }, true),
    true,
  );
  assert.equal(
    resolveSystemManagerTabBarIconOnly({ overflows: false, fitsWithSlack: true }, true),
    false,
  );
});

test('measureSystemManagerTabBarLabeledFit does not pretend zero-width bar fits labels', () => {
  const container = {
    clientWidth: 0,
    classList: { contains: () => true, remove() {}, add() {} },
    querySelectorAll: () => [] as unknown as NodeListOf<HTMLElement>,
  } as unknown as HTMLElement;

  const fit = measureSystemManagerTabBarLabeledFit(container);
  assert.equal(fit.overflows, false);
  assert.equal(fit.fitsWithSlack, false);
  // Keep icon-only while the host is hidden / not laid out.
  assert.equal(resolveSystemManagerTabBarIconOnly(fit, true), true);
});
