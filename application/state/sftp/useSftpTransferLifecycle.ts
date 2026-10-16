import { useEffect, useLayoutEffect, useRef } from "react";

import { sftpTransferCenterStore } from "../sftpTransferCenterStore";

export function useReportSftpTransferOwnerActivity(params: {
  ownerId: string;
  activeTransfersCount: number;
  onActiveTransfersChange?: (count: number) => void;
}) {
  const onChangeRef = useRef(params.onActiveTransfersChange);
  onChangeRef.current = params.onActiveTransfersChange;

  useLayoutEffect(() => {
    onChangeRef.current?.(params.activeTransfersCount);
  }, [params.activeTransfersCount]);

  useEffect(() => () => {
    const unfinished = sftpTransferCenterStore.getSnapshot().tasks.filter((task) => (
      task.ownerId === params.ownerId
      && !task.parentTaskId
      && task.status !== "completed"
      && task.status !== "cancelled"
    )).length;
    onChangeRef.current?.(unfinished);
  }, [params.ownerId]);
}
