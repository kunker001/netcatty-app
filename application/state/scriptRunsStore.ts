import type { ScriptRun } from '@/types/global/netcatty-bridge-script.d.ts';

type Listener = () => void;

/**
 * External store for script automation runs so Scripts side panel can update
 * without forcing TerminalLayerInner re-renders on every log/status tick.
 */
class ScriptRunsStore {
  private snapshot: readonly ScriptRun[] = [];
  private listeners = new Set<Listener>();

  getSnapshot = (): readonly ScriptRun[] => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  setSnapshot(next: readonly ScriptRun[]): void {
    if (this.snapshot === next) return;
    this.snapshot = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const scriptRunsStore = new ScriptRunsStore();

export function publishScriptRunsSnapshot(runs: readonly ScriptRun[]): void {
  scriptRunsStore.setSnapshot(runs);
}

export function getScriptRunsSnapshot(): readonly ScriptRun[] {
  return scriptRunsStore.getSnapshot();
}

export function subscribeScriptRuns(listener: Listener): () => void {
  return scriptRunsStore.subscribe(listener);
}
