/**
 * Schedule a batch of host connections across separate frames instead of all
 * at once.
 *
 * Connecting many hosts in a single synchronous pass mounts every terminal in
 * one React commit, so each terminal's `createXTermRuntime()` (which spins up a
 * live WebGL context) runs back-to-back on the main thread and freezes the UI
 * until the whole batch finishes. Staggering lets the first tab paint
 * immediately and gives the renderer room to breathe between mounts.
 *
 * The first target connects synchronously so a tab shows up without delay; the
 * rest are deferred one `stepMs` apart. `schedule` is injectable for testing.
 */
export type StaggerScheduler = (callback: () => void, delayMs: number) => void;

export interface ConnectHostsStaggeredOptions {
  /** Gap between successive deferred connections, in ms. */
  stepMs?: number;
  /** Defers a callback; defaults to setTimeout. */
  schedule?: StaggerScheduler;
}

const defaultSchedule: StaggerScheduler = (callback, delayMs) => {
  setTimeout(callback, delayMs);
};

export function connectHostsStaggered<T>(
  targets: T[],
  onConnect: (target: T) => void,
  options: ConnectHostsStaggeredOptions = {},
): void {
  const stepMs = options.stepMs ?? 90;
  const schedule = options.schedule ?? defaultSchedule;

  targets.forEach((target, index) => {
    if (index === 0) {
      onConnect(target);
    } else {
      schedule(() => onConnect(target), index * stepMs);
    }
  });
}
