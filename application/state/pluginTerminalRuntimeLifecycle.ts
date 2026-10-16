export interface PluginTerminalRuntimeLifecycleSink {
  onCommandSubmitted(): void;
  onCommandCompleted(): void;
  onCwdChanged(cwd: string | null): void;
  onTitleChanged(title: string | null): void;
  onResized(cols: number, rows: number): void;
  onAlternateScreenChanged(alternateScreen: boolean): void;
}

export type PluginTerminalRuntimeLifecycleEventType =
  | 'commandSubmitted'
  | 'commandCompleted'
  | 'cwdChanged'
  | 'titleChanged'
  | 'resized'
  | 'alternateScreenChanged';

export function publishPluginTerminalRuntimeLifecycleEvent(
  lifecycle: PluginTerminalRuntimeLifecycleSink,
  type: PluginTerminalRuntimeLifecycleEventType,
  details: Partial<NetcattyTerminalSessionSnapshot> = {},
): void {
  switch (type) {
    case 'commandSubmitted':
      lifecycle.onCommandSubmitted();
      return;
    case 'commandCompleted':
      lifecycle.onCommandCompleted();
      return;
    case 'cwdChanged':
      lifecycle.onCwdChanged(Object.hasOwn(details, 'cwd') ? details.cwd ?? null : null);
      return;
    case 'titleChanged':
      lifecycle.onTitleChanged(Object.hasOwn(details, 'title') ? details.title ?? null : null);
      return;
    case 'resized':
      if (details.cols != null && details.rows != null) lifecycle.onResized(details.cols, details.rows);
      return;
    case 'alternateScreenChanged':
      if (details.alternateScreen != null) lifecycle.onAlternateScreenChanged(details.alternateScreen);
  }
}
