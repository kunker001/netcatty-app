import { useCallback } from "react";
import { netcattyBridge } from "../../infrastructure/services/netcattyBridge";

export type ApplicationInfo = {
  name: string;
  version: string;
  platform: string;
};

export type SshAgentStatus = {
  running: boolean;
  startupType: string | null;
  error: string | null;
};

export const useApplicationBackend = () => {
  const openExternal = useCallback(async (url: string) => {
    const bridge = netcattyBridge.get();
    if (bridge?.openExternal) {
      // Bridge resolves on success (either via system browser or in-app
      // fallback window) and rejects only when both paths fail. Let the
      // rejection propagate so callers can present a user-facing message.
      await bridge.openExternal(url);
      return;
    }
    // Fallback for non-Electron environments (tests, dev server, etc.).
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const getApplicationInfo = useCallback(async (): Promise<ApplicationInfo | null> => {
    const bridge = netcattyBridge.get();
    const info = await bridge?.getAppInfo?.();
    return info ?? null;
  }, []);

  const checkSshAgent = useCallback(async (options?: {
    identityAgent?: string;
    agentForwarding?: boolean;
    hostname?: string;
    port?: number;
    username?: string;
  }): Promise<SshAgentStatus | null> => {
    const bridge = netcattyBridge.get();
    const status = await bridge?.checkSshAgent?.(options);
    return status ?? null;
  }, []);

  return { openExternal, getApplicationInfo, checkSshAgent };
};
