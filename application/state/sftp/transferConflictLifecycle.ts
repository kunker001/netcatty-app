import type { FileConflictAction, TransferTask } from "../../../domain/models";

export type TransferConflictDefaults = Map<string, Map<string, FileConflictAction>>;

export interface DeferredTransferAttemptIdentity {
  taskId: string;
  ownerId: string;
  sourceConnectionId: string;
  targetConnectionId: string;
  sourceConnectionKey?: string;
  targetConnectionKey?: string;
  sourcePath: string;
  targetPath: string;
}

export function captureDeferredTransferAttempt(
  task: Pick<TransferTask, "id" | "sourceConnectionId" | "targetConnectionId" | "sourcePath" | "targetPath">,
  ownerId: string,
  connectionKeys: ReadonlyMap<string, string>,
): DeferredTransferAttemptIdentity {
  return {
    taskId: task.id,
    ownerId,
    sourceConnectionId: task.sourceConnectionId,
    targetConnectionId: task.targetConnectionId,
    sourceConnectionKey: connectionKeys.get(task.sourceConnectionId),
    targetConnectionKey: connectionKeys.get(task.targetConnectionId),
    sourcePath: task.sourcePath,
    targetPath: task.targetPath,
  };
}

export function isDeferredTransferAttemptCurrent(
  task: Pick<TransferTask, "id" | "ownerId" | "status" | "sourceConnectionId" | "targetConnectionId" | "sourcePath" | "targetPath"> | null | undefined,
  identity: DeferredTransferAttemptIdentity,
  connectionKeys: ReadonlyMap<string, string>,
): boolean {
  return !!task
    && task.id === identity.taskId
    && task.ownerId === identity.ownerId
    && task.status === "pending"
    && task.sourceConnectionId === identity.sourceConnectionId
    && task.targetConnectionId === identity.targetConnectionId
    && task.sourcePath === identity.sourcePath
    && task.targetPath === identity.targetPath
    && connectionKeys.get(task.sourceConnectionId) === identity.sourceConnectionKey
    && connectionKeys.get(task.targetConnectionId) === identity.targetConnectionKey;
}

const TERMINAL_TRANSFER_STATUSES = new Set<TransferTask["status"]>([
  "completed",
  "failed",
  "cancelled",
]);

/** Keep apply-to-all choices only while their transfer batch still has live work. */
export function pruneTransferConflictDefaults(
  defaults: TransferConflictDefaults,
  tasks: readonly Pick<TransferTask, "batchId" | "status">[],
): void {
  const liveBatchIds = new Set<string>();
  for (const task of tasks) {
    if (task.batchId && !TERMINAL_TRANSFER_STATUSES.has(task.status)) {
      liveBatchIds.add(task.batchId);
    }
  }
  for (const batchId of defaults.keys()) {
    // Legacy/adopted rows without a batch share a fixed, tiny conflict-type set.
    if (batchId !== "global" && !liveBatchIds.has(batchId)) defaults.delete(batchId);
  }
}

type TimerHandle = ReturnType<typeof setTimeout> | number;

export interface DeferredTransferAttemptQueue {
  readonly size: number;
  schedule(
    taskId: string,
    delayMs: number,
    isCurrent: () => boolean,
    run: () => void | Promise<void>,
  ): void;
  cancel(taskId: string): void;
  dispose(): void;
}

export function createDeferredTransferAttemptQueue(options: {
  setTimeoutFn?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimeoutFn?: (handle: TimerHandle) => void;
  onError?: (error: unknown) => void;
} = {}): DeferredTransferAttemptQueue {
  const setTimeoutFn = options.setTimeoutFn ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimeoutFn = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle));
  const entries = new Map<string, { handle: TimerHandle; token: object }>();
  let disposed = false;

  const cancel = (taskId: string) => {
    const entry = entries.get(taskId);
    if (!entry) return;
    entries.delete(taskId);
    clearTimeoutFn(entry.handle);
  };

  return {
    get size() {
      return entries.size;
    },
    schedule(taskId, delayMs, isCurrent, run) {
      if (disposed || !taskId) return;
      cancel(taskId);
      const token = {};
      const handle = setTimeoutFn(() => {
        const entry = entries.get(taskId);
        if (!entry || entry.token !== token) return;
        entries.delete(taskId);
        if (disposed || !isCurrent()) return;
        void Promise.resolve()
          .then(run)
          .catch((error) => options.onError?.(error));
      }, Math.max(0, delayMs));
      entries.set(taskId, { handle, token });
    },
    cancel,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of entries.values()) clearTimeoutFn(entry.handle);
      entries.clear();
    },
  };
}
