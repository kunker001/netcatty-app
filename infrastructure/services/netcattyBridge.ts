export class BridgeUnavailableError extends Error {
  constructor(message = "Netcatty bridge unavailable") {
    super(message);
    this.name = "BridgeUnavailableError";
  }
}

export const netcattyBridge = {
  get(): NetcattyBridge | undefined {
    return typeof window !== 'undefined' ? window.netcatty : undefined;
  },

  require(): NetcattyBridge {
    const bridge = window.netcatty;
    if (!bridge) throw new BridgeUnavailableError();
    return bridge;
  },
};
