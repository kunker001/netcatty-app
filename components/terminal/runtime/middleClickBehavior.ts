import type { MiddleClickBehavior, RightClickBehavior, TerminalSettings } from "../../../domain/models";

type MiddleClickSettings = Partial<Pick<TerminalSettings, "middleClickBehavior" | "middleClickPaste">>;
const MIDDLE_CONTEXT_MENU_EVENT_KEY = "__netcattyMiddleContextMenu";

type MiddleClickContextMenuEvent = MouseEvent & {
  [MIDDLE_CONTEXT_MENU_EVENT_KEY]?: boolean;
};

const SHIFT_SELECTION_REPLAY_EVENT_KEY = "__netcattyShiftSelectionReplay";

type ShiftSelectionReplayMouseEvent = MouseEvent & {
  [SHIFT_SELECTION_REPLAY_EVENT_KEY]?: boolean;
};

export interface MouseTrackingContextMenuCaptureState {
  event: MouseEvent;
  mouseTracking: boolean;
  /** Current xterm mouse tracking mode, when available at event time. */
  terminalMouseTrackingMode?: string;
  status?: string | null;
  /** The user's configured right-click action. */
  rightClickBehavior?: RightClickBehavior;
  /** When true, show the app context menu over fullscreen apps (tmux/vim). */
  forceMenuInAlternateScreen?: boolean;
}

export interface ShiftMouseSelectionReplayState {
  event: MouseEvent;
  mouseTracking: boolean;
  status?: string | null;
  isMacPlatform: boolean;
}

export interface ShiftRightClickMouseDownCaptureState {
  event: MouseEvent;
  mouseTracking: boolean;
  /** Current xterm mouse tracking mode, when available at event time. */
  terminalMouseTrackingMode?: string;
  status?: string | null;
  /** The user's configured right-click action. */
  rightClickBehavior?: RightClickBehavior;
  /** When true, show the app context menu over fullscreen apps (tmux/vim). */
  forceMenuInAlternateScreen?: boolean;
}

export const resolveMiddleClickBehavior = (
  settings?: MiddleClickSettings | null,
): MiddleClickBehavior => {
  const behavior = settings?.middleClickBehavior;
  if (
    behavior === "context-menu" ||
    behavior === "paste" ||
    behavior === "disabled"
  ) {
    return behavior;
  }

  return settings?.middleClickPaste === false ? "disabled" : "paste";
};

export const markMiddleClickContextMenuEvent = (event: MouseEvent): MouseEvent => {
  Object.defineProperty(event, MIDDLE_CONTEXT_MENU_EVENT_KEY, {
    value: true,
    configurable: true,
  });
  return event;
};

export const isMiddleClickContextMenuEvent = (event: MouseEvent): boolean =>
  (event as MiddleClickContextMenuEvent)[MIDDLE_CONTEXT_MENU_EVENT_KEY] === true;

export const markShiftSelectionReplayMouseEvent = (event: MouseEvent): MouseEvent => {
  Object.defineProperty(event, SHIFT_SELECTION_REPLAY_EVENT_KEY, {
    value: true,
    configurable: true,
  });
  return event;
};

export const isShiftSelectionReplayMouseEvent = (event: MouseEvent): boolean =>
  (event as ShiftSelectionReplayMouseEvent)[SHIFT_SELECTION_REPLAY_EVENT_KEY] === true;

// When the "show context menu over fullscreen apps" setting is on and the
// right-click action is the context menu, an unmodified right-click should
// behave like Shift+right-click: let the contextmenu event through so Radix
// opens the app menu, and stop the button press from reaching the TUI. Paste /
// select-word actions are unaffected — the setting is about the menu only.
const forcesMenuOverMouseTracking = ({
  rightClickBehavior,
  forceMenuInAlternateScreen,
}: {
  rightClickBehavior?: RightClickBehavior;
  forceMenuInAlternateScreen?: boolean;
}): boolean => Boolean(forceMenuInAlternateScreen && rightClickBehavior === "context-menu");

export const isMouseTrackingActive = ({
  mouseTracking,
  terminalMouseTrackingMode,
}: Pick<MouseTrackingContextMenuCaptureState, "mouseTracking" | "terminalMouseTrackingMode">): boolean =>
  terminalMouseTrackingMode === undefined
    ? mouseTracking
    : terminalMouseTrackingMode !== "none";

export const shouldInterceptMouseTrackingContextMenu = ({
  event,
  mouseTracking,
  terminalMouseTrackingMode,
  status,
  rightClickBehavior,
  forceMenuInAlternateScreen,
}: MouseTrackingContextMenuCaptureState): boolean =>
  isMouseTrackingActive({ mouseTracking, terminalMouseTrackingMode })
  && status === "connected"
  && !event.shiftKey
  && !isMiddleClickContextMenuEvent(event)
  && !forcesMenuOverMouseTracking({ rightClickBehavior, forceMenuInAlternateScreen });

export const shouldReplayShiftMouseSelectionAsMacOption = ({
  event,
  mouseTracking,
  status,
  isMacPlatform,
}: ShiftMouseSelectionReplayState): boolean =>
  isMacPlatform
  && mouseTracking
  && status === "connected"
  && event.button === 0
  && event.shiftKey
  && !event.altKey
  && !event.ctrlKey
  && !event.metaKey
  && !isShiftSelectionReplayMouseEvent(event);

export const shouldStopShiftRightClickMouseTrackingMouseDown = ({
  event,
  mouseTracking,
  terminalMouseTrackingMode,
  status,
  rightClickBehavior,
  forceMenuInAlternateScreen,
}: ShiftRightClickMouseDownCaptureState): boolean =>
  isMouseTrackingActive({ mouseTracking, terminalMouseTrackingMode })
  && status === "connected"
  && event.button === 2
  && (event.shiftKey || forcesMenuOverMouseTracking({ rightClickBehavior, forceMenuInAlternateScreen }));

// Pair mouseup with mousedown ownership. When Netcatty claims the press
// (Shift / fullscreen-apps menu), also swallow the release so xterm never
// reports a lone button-up. When the TUI owns the press (Herdr, tmux menus,
// vim, ...), the release must reach xterm too - otherwise the app stays stuck
// with the right button held and mouse UI dies until restart (#2721).
// Ownership is remembered from the actual mousedown claim — never re-derived
// from mouseup modifiers (Shift may change between press and release).
export interface RightClickMouseTrackingPressClaim {
  /** Evaluate + record whether this right-button mousedown was claimed. */
  noteMouseDown: (state: ShiftRightClickMouseDownCaptureState) => boolean;
  /** Consume the pending claim for a right-button mouseup (clears state). */
  consumeMouseUpClaim: (event: MouseEvent) => boolean;
}

export const createRightClickMouseTrackingPressClaim = (): RightClickMouseTrackingPressClaim => {
  let claimedMatchingMouseDown = false;

  return {
    noteMouseDown(state) {
      const shouldStop = shouldStopShiftRightClickMouseTrackingMouseDown(state);
      if (state.event.button === 2) {
        claimedMatchingMouseDown = shouldStop;
      }
      return shouldStop;
    },
    consumeMouseUpClaim(event) {
      if (event.button !== 2) return false;
      const claimed = claimedMatchingMouseDown;
      claimedMatchingMouseDown = false;
      return claimed;
    },
  };
};

export const shouldStopRightClickMouseTrackingMouseUp = ({
  event,
  claimedMatchingMouseDown,
}: {
  event: MouseEvent;
  claimedMatchingMouseDown: boolean;
}): boolean => event.button === 2 && claimedMatchingMouseDown;

export const createMacOptionForcedSelectionMouseEvent = (event: MouseEvent): MouseEvent =>
  markShiftSelectionReplayMouseEvent(new MouseEvent(event.type, {
    bubbles: event.bubbles,
    cancelable: event.cancelable,
    composed: event.composed,
    detail: event.detail,
    view: event.view,
    screenX: event.screenX,
    screenY: event.screenY,
    clientX: event.clientX,
    clientY: event.clientY,
    ctrlKey: event.ctrlKey,
    altKey: true,
    shiftKey: false,
    metaKey: event.metaKey,
    button: event.button,
    buttons: event.buttons,
    relatedTarget: event.relatedTarget,
  }));

export const captureMiddleClickTerminalMouseEvent = (event: MouseEvent): boolean => {
  if (event.button !== 1) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
};
