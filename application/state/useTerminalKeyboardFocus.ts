import { useEffect } from "react";
import { netcattyBridge } from "../../infrastructure/services/netcattyBridge";
import { installTerminalKeyboardFocusTracking } from "./terminalKeyboardFocus";

export function useTerminalKeyboardFocus(enabled = true): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const bridge = netcattyBridge.get();
    if (!bridge?.setTerminalKeyboardFocus) return undefined;

    let lastPublished: boolean | undefined;
    const publish = (focused: boolean) => {
      if (focused === lastPublished) return;
      lastPublished = focused;
      try {
        bridge.setTerminalKeyboardFocus?.(focused);
      } catch {
        // Browser preview or a disposed Electron bridge.
      }
    };

    const cleanupTracking = installTerminalKeyboardFocusTracking(
      document,
      window,
      publish,
    );

    return () => {
      cleanupTracking();
      publish(false);
    };
  }, [enabled]);
}
