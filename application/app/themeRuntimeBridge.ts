/**
 * Theme runtime actions produced by TerminalHost (`useThemeRuntime`).
 * AppSideEffects handlers (default/follow theme changes) call through this
 * bridge instead of co-hosting the hook.
 */

type Listener = () => void;

export type ThemeRuntimeBridgeActions = {
  clearThemeIntent: () => void;
  settleManualThemeIntent: () => void;
  pickTerminalTheme: (themeId: string) => void;
  resolveFocusedAppearance: (...args: never[]) => unknown;
  currentTerminalTheme: unknown;
  globalAppearance: unknown;
};

class ThemeRuntimeBridge {
  private actions: ThemeRuntimeBridgeActions | null = null;
  private listeners = new Set<Listener>();

  get = (): ThemeRuntimeBridgeActions | null => this.actions;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(next: ThemeRuntimeBridgeActions | null): void {
    if (this.actions === next) return;
    this.actions = next;
    for (const listener of this.listeners) listener();
  }
}

const bridge = new ThemeRuntimeBridge();

export function registerThemeRuntimeActions(
  actions: ThemeRuntimeBridgeActions | null,
): void {
  bridge.set(actions);
}

export function getThemeRuntimeActions(): ThemeRuntimeBridgeActions | null {
  return bridge.get();
}

export function subscribeThemeRuntimeActions(listener: Listener): () => void {
  return bridge.subscribe(listener);
}
