import { useCallback } from "react";
import { netcattyBridge } from "../../infrastructure/services/netcattyBridge";

export const useKnownHostsBackend = () => {
  const readKnownHosts = useCallback(async () => {
    const bridge = netcattyBridge.get();
    return bridge?.readKnownHosts?.();
  }, []);

  return { readKnownHosts };
};

