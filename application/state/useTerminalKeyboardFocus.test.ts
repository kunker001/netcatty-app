import assert from "node:assert/strict";
import test from "node:test";

import {
  installTerminalKeyboardFocusTracking,
  isTerminalKeyboardTarget,
} from "./terminalKeyboardFocus";

const targetWithClosest = (matches: boolean) => ({
  closest: (selector: string) => {
    assert.match(selector, /\.xterm/);
    return matches ? {} : null;
  },
}) as unknown as EventTarget;

test("terminal keyboard target detection recognizes xterm descendants", () => {
  assert.equal(isTerminalKeyboardTarget(targetWithClosest(true)), true);
  assert.equal(isTerminalKeyboardTarget(targetWithClosest(false)), false);
  assert.equal(isTerminalKeyboardTarget(null), false);
});

test("terminal keyboard focus tracking publishes deduplicated focus transitions and cleans up", async () => {
  const listeners = new Map<string, (event?: Event) => void>();
  const removed: string[] = [];
  const body = targetWithClosest(false);
  const terminal = targetWithClosest(true);
  const documentRef = {
    activeElement: body as unknown as Element,
    addEventListener: (type: string, listener: (event?: Event) => void) => {
      listeners.set(type, listener);
    },
    removeEventListener: (type: string) => {
      removed.push(type);
    },
  } as unknown as Document;
  const windowRef = {
    addEventListener: (type: string, listener: (event?: Event) => void) => {
      listeners.set(`window:${type}`, listener);
    },
    removeEventListener: (type: string) => {
      removed.push(`window:${type}`);
    },
  } as unknown as Window;
  const changes: boolean[] = [];
  const cleanup = installTerminalKeyboardFocusTracking(documentRef, windowRef, (focused) => {
    if (changes.at(-1) !== focused) changes.push(focused);
  });

  assert.deepEqual(changes, [false]);

  listeners.get("pointerdown")?.({ target: terminal } as unknown as Event);
  listeners.get("focusin")?.({ target: terminal } as unknown as Event);
  assert.deepEqual(changes, [false, true]);

  (documentRef as unknown as { activeElement: Element }).activeElement = terminal as unknown as Element;
  listeners.get("pointerdown")?.({ target: body } as unknown as Event);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(changes, [false, true]);

  (documentRef as unknown as { activeElement: Element }).activeElement = body as unknown as Element;
  listeners.get("focusout")?.();
  await Promise.resolve();
  assert.deepEqual(changes, [false, true, false]);

  listeners.get("window:blur")?.();
  assert.deepEqual(changes, [false, true, false]);

  (documentRef as unknown as { activeElement: Element }).activeElement = terminal as unknown as Element;
  listeners.get("window:focus")?.();
  assert.deepEqual(changes, [false, true, false, true]);

  cleanup();
  assert.deepEqual(removed.sort(), ["focusin", "focusout", "pointerdown", "window:blur", "window:focus"]);
});
