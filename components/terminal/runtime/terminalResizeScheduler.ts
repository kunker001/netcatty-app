export type TerminalResizeRequest = Readonly<{
  sessionId: string;
  cols: number;
  rows: number;
}>;

export type TerminalResizeScheduler = Readonly<{
  schedule: (request: TerminalResizeRequest) => void;
  dispose: () => void;
}>;

export function createTerminalResizeScheduler(
  delayMs: number,
  apply: (request: TerminalResizeRequest) => void,
): TerminalResizeScheduler {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  return Object.freeze({
    schedule(request: TerminalResizeRequest) {
      if (disposed) return;
      if (timeout) clearTimeout(timeout);
      const pendingRequest = Object.freeze({ ...request });
      timeout = setTimeout(() => {
        timeout = null;
        if (disposed) return;
        apply(pendingRequest);
      }, delayMs);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    },
  });
}
