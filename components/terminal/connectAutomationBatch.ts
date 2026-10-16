export interface ConnectAutomationBatch {
  controller: AbortController;
  stopCurrentRun: (() => Promise<void>) | null;
}

export const createConnectAutomationBatch = (): ConnectAutomationBatch => ({
  controller: new AbortController(),
  stopCurrentRun: null,
});

export const trackConnectAutomationStop = (
  batch: ConnectAutomationBatch,
  stopCurrentRun: (() => Promise<void>) | null,
): void => {
  batch.stopCurrentRun = stopCurrentRun;
};

export const cancelConnectAutomationBatch = async (
  batch: ConnectAutomationBatch,
): Promise<void> => {
  batch.controller.abort();
  if (batch.stopCurrentRun) {
    await batch.stopCurrentRun();
  }
};
