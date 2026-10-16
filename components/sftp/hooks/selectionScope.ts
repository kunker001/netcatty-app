import type { SftpStateApi } from "../../../application/state/useSftpState";
import { sftpTreeSelectionStore } from "../../../application/state/sftp/sftpTreeSelectionStore";

export interface SftpSelectionTarget {
  side: "left" | "right";
  tabId: string;
}

export const keepOnlyPaneSelections = (
  sftp: SftpStateApi,
  target: SftpSelectionTarget | null,
) => {
  sftp.clearSelectionsExcept(target);
  const paneIds = [
    ...sftp.leftTabs.tabs.map((tab) => tab.id),
    ...sftp.rightTabs.tabs.map((tab) => tab.id),
  ];
  for (const paneId of paneIds) {
    if (target?.tabId === paneId) continue;
    sftpTreeSelectionStore.clearSelection(paneId);
  }
};

export const keepOnlyActivePaneSelections = (
  sftp: SftpStateApi,
  side: "left" | "right",
): SftpSelectionTarget | null => {
  const tabId = sftp.getActiveTabId(side);
  if (!tabId) {
    keepOnlyPaneSelections(sftp, null);
    return null;
  }

  const target = { side, tabId } as const;
  keepOnlyPaneSelections(sftp, target);
  return target;
};
