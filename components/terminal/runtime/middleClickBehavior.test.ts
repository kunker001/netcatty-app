import assert from "node:assert/strict";
import test from "node:test";

import {
  createRightClickMouseTrackingPressClaim,
  isMiddleClickContextMenuEvent,
  isShiftSelectionReplayMouseEvent,
  markMiddleClickContextMenuEvent,
  markShiftSelectionReplayMouseEvent,
  captureMiddleClickTerminalMouseEvent,
  resolveMiddleClickBehavior,
  shouldInterceptMouseTrackingContextMenu,
  shouldReplayShiftMouseSelectionAsMacOption,
  shouldStopRightClickMouseTrackingMouseUp,
  shouldStopShiftRightClickMouseTrackingMouseDown,
} from "./middleClickBehavior";

test("resolveMiddleClickBehavior uses the explicit middle-click behavior", () => {
  assert.equal(resolveMiddleClickBehavior({ middleClickBehavior: "context-menu" }), "context-menu");
  assert.equal(resolveMiddleClickBehavior({ middleClickBehavior: "disabled" }), "disabled");
});

test("resolveMiddleClickBehavior ignores unsupported middle-click behavior values", () => {
  assert.equal(
    resolveMiddleClickBehavior({ middleClickBehavior: "select-word" as never }),
    "paste",
  );
});

test("resolveMiddleClickBehavior falls back to the legacy middle-click paste flag", () => {
  assert.equal(resolveMiddleClickBehavior({ middleClickPaste: true }), "paste");
  assert.equal(resolveMiddleClickBehavior({ middleClickPaste: false }), "disabled");
  assert.equal(resolveMiddleClickBehavior(undefined), "paste");
});

test("middle-click context menu events are identifiable", () => {
  const event = {} as MouseEvent;

  assert.equal(isMiddleClickContextMenuEvent(event), false);
  assert.equal(isMiddleClickContextMenuEvent(markMiddleClickContextMenuEvent(event)), true);
});

test("mouse-tracking context menu capture lets middle-click menu events pass through", () => {
  assert.equal(
    shouldInterceptMouseTrackingContextMenu({
      event: markMiddleClickContextMenuEvent({} as MouseEvent),
      mouseTracking: true,
      status: "connected",
    }),
    false,
  );
  assert.equal(
    shouldInterceptMouseTrackingContextMenu({
      event: {} as MouseEvent,
      mouseTracking: true,
      status: "connected",
    }),
    true,
  );
});

test("mouse-tracking context menu capture lets Shift-modified mouse events pass through", () => {
  assert.equal(
    shouldInterceptMouseTrackingContextMenu({
      event: { shiftKey: true } as MouseEvent,
      mouseTracking: true,
      status: "connected",
    }),
    false,
  );
});

test("mouse-tracking context menu capture prefers the terminal's current mode over stale cached state", () => {
  assert.equal(
    shouldInterceptMouseTrackingContextMenu({
      event: { shiftKey: false } as MouseEvent,
      mouseTracking: false,
      terminalMouseTrackingMode: "vt200",
      status: "connected",
    }),
    true,
  );
  assert.equal(
    shouldInterceptMouseTrackingContextMenu({
      event: { shiftKey: false } as MouseEvent,
      mouseTracking: true,
      terminalMouseTrackingMode: "none",
      status: "connected",
    }),
    false,
  );
});

test("mouse-tracking context menu capture yields to the fullscreen-apps menu setting for context-menu clicks", () => {
  // Setting on + context-menu behavior: do NOT intercept, so Radix opens the menu.
  assert.equal(
    shouldInterceptMouseTrackingContextMenu({
      event: { shiftKey: false } as MouseEvent,
      mouseTracking: true,
      status: "connected",
      rightClickBehavior: "context-menu",
      forceMenuInAlternateScreen: true,
    }),
    false,
  );
  // Setting on but paste behavior: still intercept (setting is menu-only).
  assert.equal(
    shouldInterceptMouseTrackingContextMenu({
      event: { shiftKey: false } as MouseEvent,
      mouseTracking: true,
      status: "connected",
      rightClickBehavior: "paste",
      forceMenuInAlternateScreen: true,
    }),
    true,
  );
  // Setting off (default): still intercept even for context-menu behavior.
  assert.equal(
    shouldInterceptMouseTrackingContextMenu({
      event: { shiftKey: false } as MouseEvent,
      mouseTracking: true,
      status: "connected",
      rightClickBehavior: "context-menu",
      forceMenuInAlternateScreen: false,
    }),
    true,
  );
});

test("Shift selection replay events are identifiable", () => {
  const event = {} as MouseEvent;

  assert.equal(isShiftSelectionReplayMouseEvent(event), false);
  assert.equal(isShiftSelectionReplayMouseEvent(markShiftSelectionReplayMouseEvent(event)), true);
});

test("macOS mouse tracking replays plain Shift left-click as xterm option selection", () => {
  const event = {
    button: 0,
    shiftKey: true,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
  } as MouseEvent;

  assert.equal(
    shouldReplayShiftMouseSelectionAsMacOption({
      event,
      mouseTracking: true,
      status: "connected",
      isMacPlatform: true,
    }),
    true,
  );
});

test("Shift selection replay is limited to the macOS connected mouse-tracking case", () => {
  const baseEvent = {
    button: 0,
    shiftKey: true,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
  } as MouseEvent;

  assert.equal(
    shouldReplayShiftMouseSelectionAsMacOption({
      event: baseEvent,
      mouseTracking: true,
      status: "connected",
      isMacPlatform: false,
    }),
    false,
  );
  assert.equal(
    shouldReplayShiftMouseSelectionAsMacOption({
      event: baseEvent,
      mouseTracking: false,
      status: "connected",
      isMacPlatform: true,
    }),
    false,
  );
  assert.equal(
    shouldReplayShiftMouseSelectionAsMacOption({
      event: baseEvent,
      mouseTracking: true,
      status: "disconnected",
      isMacPlatform: true,
    }),
    false,
  );
  assert.equal(
    shouldReplayShiftMouseSelectionAsMacOption({
      event: { ...baseEvent, button: 2 } as MouseEvent,
      mouseTracking: true,
      status: "connected",
      isMacPlatform: true,
    }),
    false,
  );
  assert.equal(
    shouldReplayShiftMouseSelectionAsMacOption({
      event: { ...baseEvent, shiftKey: false } as MouseEvent,
      mouseTracking: true,
      status: "connected",
      isMacPlatform: true,
    }),
    false,
  );
});

test("Shift selection replay ignores modified and already replayed mouse events", () => {
  const baseEvent = {
    button: 0,
    shiftKey: true,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
  } as MouseEvent;

  for (const event of [
    { ...baseEvent, altKey: true },
    { ...baseEvent, ctrlKey: true },
    { ...baseEvent, metaKey: true },
    markShiftSelectionReplayMouseEvent({ ...baseEvent } as MouseEvent),
  ]) {
    assert.equal(
      shouldReplayShiftMouseSelectionAsMacOption({
        event: event as MouseEvent,
        mouseTracking: true,
        status: "connected",
        isMacPlatform: true,
      }),
      false,
    );
  }
});

test("Shift right-click mousedown is stopped while connected mouse tracking is active", () => {
  assert.equal(
    shouldStopShiftRightClickMouseTrackingMouseDown({
      event: {
        button: 2,
        shiftKey: true,
      } as MouseEvent,
      mouseTracking: true,
      status: "connected",
    }),
    true,
  );
});

test("right-click mousedown is stopped when the fullscreen-apps menu setting forces the context menu", () => {
  // Unmodified right-click + setting on + context-menu behavior: stop it, like Shift+right-click.
  assert.equal(
    shouldStopShiftRightClickMouseTrackingMouseDown({
      event: { button: 2, shiftKey: false } as MouseEvent,
      mouseTracking: true,
      status: "connected",
      rightClickBehavior: "context-menu",
      forceMenuInAlternateScreen: true,
    }),
    true,
  );
  // Setting on but paste behavior: do not stop (menu-only setting).
  assert.equal(
    shouldStopShiftRightClickMouseTrackingMouseDown({
      event: { button: 2, shiftKey: false } as MouseEvent,
      mouseTracking: true,
      status: "connected",
      rightClickBehavior: "paste",
      forceMenuInAlternateScreen: true,
    }),
    false,
  );
});

test("right-click mousedown also uses the terminal's current mode", () => {
  assert.equal(
    shouldStopShiftRightClickMouseTrackingMouseDown({
      event: { button: 2, shiftKey: false } as MouseEvent,
      mouseTracking: false,
      terminalMouseTrackingMode: "vt200",
      status: "connected",
      rightClickBehavior: "context-menu",
      forceMenuInAlternateScreen: true,
    }),
    true,
  );
  assert.equal(
    shouldStopShiftRightClickMouseTrackingMouseDown({
      event: { button: 2, shiftKey: false } as MouseEvent,
      mouseTracking: true,
      terminalMouseTrackingMode: "none",
      status: "connected",
      rightClickBehavior: "context-menu",
      forceMenuInAlternateScreen: true,
    }),
    false,
  );
});

test("Shift right-click mousedown capture is limited to connected mouse tracking", () => {
  const baseEvent = {
    button: 2,
    shiftKey: true,
  } as MouseEvent;

  assert.equal(
    shouldStopShiftRightClickMouseTrackingMouseDown({
      event: baseEvent,
      mouseTracking: false,
      status: "connected",
    }),
    false,
  );
  assert.equal(
    shouldStopShiftRightClickMouseTrackingMouseDown({
      event: baseEvent,
      mouseTracking: true,
      status: "disconnected",
    }),
    false,
  );
  assert.equal(
    shouldStopShiftRightClickMouseTrackingMouseDown({
      event: {
        button: 2,
        shiftKey: false,
      } as MouseEvent,
      mouseTracking: true,
      status: "connected",
    }),
    false,
  );
  assert.equal(
    shouldStopShiftRightClickMouseTrackingMouseDown({
      event: {
        button: 0,
        shiftKey: true,
      } as MouseEvent,
      mouseTracking: true,
      status: "connected",
    }),
    false,
  );
});

test("right-click mouseup reaches mouse-tracking apps when Netcatty did not claim the press", () => {
  // Herdr / Terminal.app: button-down was delivered, so button-up must be too.
  // Swallowing mouseup leaves the TUI stuck thinking the right button is held (#2721).
  const claim = createRightClickMouseTrackingPressClaim();
  assert.equal(
    claim.noteMouseDown({
      event: { button: 2, shiftKey: false } as MouseEvent,
      mouseTracking: true,
      status: "connected",
      rightClickBehavior: "context-menu",
      forceMenuInAlternateScreen: false,
    }),
    false,
  );
  assert.equal(
    shouldStopRightClickMouseTrackingMouseUp({
      event: { button: 2, shiftKey: false } as MouseEvent,
      claimedMatchingMouseDown: claim.consumeMouseUpClaim({ button: 2 } as MouseEvent),
    }),
    false,
  );
});

test("right-click mouseup is stopped only when Netcatty claimed the matching mousedown", () => {
  const shiftClaim = createRightClickMouseTrackingPressClaim();
  assert.equal(
    shiftClaim.noteMouseDown({
      event: { button: 2, shiftKey: true } as MouseEvent,
      mouseTracking: true,
      status: "connected",
    }),
    true,
  );
  assert.equal(
    shouldStopRightClickMouseTrackingMouseUp({
      event: { button: 2, shiftKey: true } as MouseEvent,
      claimedMatchingMouseDown: shiftClaim.consumeMouseUpClaim({ button: 2 } as MouseEvent),
    }),
    true,
  );

  const forceMenuClaim = createRightClickMouseTrackingPressClaim();
  assert.equal(
    forceMenuClaim.noteMouseDown({
      event: { button: 2, shiftKey: false } as MouseEvent,
      mouseTracking: true,
      status: "connected",
      rightClickBehavior: "context-menu",
      forceMenuInAlternateScreen: true,
    }),
    true,
  );
  assert.equal(
    shouldStopRightClickMouseTrackingMouseUp({
      event: { button: 2, shiftKey: false } as MouseEvent,
      claimedMatchingMouseDown: forceMenuClaim.consumeMouseUpClaim({ button: 2 } as MouseEvent),
    }),
    true,
  );

  assert.equal(
    shouldStopRightClickMouseTrackingMouseUp({
      event: { button: 0, shiftKey: false } as MouseEvent,
      claimedMatchingMouseDown: false,
    }),
    false,
  );
});

test("right-click mouseup pairs with the claimed mousedown, not the release modifiers", () => {
  // Shift+right press claimed by Netcatty, then Shift released before mouseup:
  // still swallow the release so xterm never sees a lone button-up.
  const claimedThenShiftReleased = createRightClickMouseTrackingPressClaim();
  assert.equal(
    claimedThenShiftReleased.noteMouseDown({
      event: { button: 2, shiftKey: true } as MouseEvent,
      mouseTracking: true,
      status: "connected",
    }),
    true,
  );
  assert.equal(
    shouldStopRightClickMouseTrackingMouseUp({
      event: { button: 2, shiftKey: false } as MouseEvent,
      claimedMatchingMouseDown: claimedThenShiftReleased.consumeMouseUpClaim(
        { button: 2, shiftKey: false } as MouseEvent,
      ),
    }),
    true,
  );

  // App-owned press, then Shift held on release: release must still reach xterm.
  const appOwnedThenShiftAdded = createRightClickMouseTrackingPressClaim();
  assert.equal(
    appOwnedThenShiftAdded.noteMouseDown({
      event: { button: 2, shiftKey: false } as MouseEvent,
      mouseTracking: true,
      status: "connected",
    }),
    false,
  );
  assert.equal(
    shouldStopRightClickMouseTrackingMouseUp({
      event: { button: 2, shiftKey: true } as MouseEvent,
      claimedMatchingMouseDown: appOwnedThenShiftAdded.consumeMouseUpClaim(
        { button: 2, shiftKey: true } as MouseEvent,
      ),
    }),
    false,
  );
});

test("middle-click terminal mouse down/up events are captured before xterm sees them", () => {
  const calls: string[] = [];
  const middleClickEvent = {
    button: 1,
    preventDefault: () => calls.push("preventDefault"),
    stopImmediatePropagation: () => calls.push("stopImmediatePropagation"),
  } as unknown as MouseEvent;

  assert.equal(captureMiddleClickTerminalMouseEvent(middleClickEvent), true);
  assert.deepEqual(calls, ["preventDefault", "stopImmediatePropagation"]);

  calls.length = 0;
  assert.equal(captureMiddleClickTerminalMouseEvent({
    button: 0,
    preventDefault: () => calls.push("preventDefault"),
    stopImmediatePropagation: () => calls.push("stopImmediatePropagation"),
  } as unknown as MouseEvent), false);
  assert.deepEqual(calls, []);
});
