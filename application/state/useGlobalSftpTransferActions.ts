import { useCallback, useMemo } from "react";

import type { TransferTask } from "../../domain/models";
import {
  getGlobalTransferBatchEligibility,
  listGloballyPausableTransferIds,
  listGloballyResumableTransferIds,
} from "../../domain/sftpTransferActions";
import { sftpTransferCenterStore } from "./sftpTransferCenterStore";

export function useGlobalSftpTransferActions(tasks: readonly TransferTask[]) {
  const batchEligibility = useMemo(
    () => getGlobalTransferBatchEligibility(tasks),
    [tasks],
  );
  const pauseAll = useCallback(() => {
    for (const taskId of listGloballyPausableTransferIds(tasks)) {
      void sftpTransferCenterStore.pause(taskId);
    }
  }, [tasks]);
  const resumeAll = useCallback(() => {
    for (const taskId of listGloballyResumableTransferIds(tasks)) {
      void sftpTransferCenterStore.resume(taskId);
    }
  }, [tasks]);

  return { batchEligibility, pauseAll, resumeAll };
}
