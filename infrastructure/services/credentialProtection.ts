import { netcattyBridge } from "./netcattyBridge";

export const getCredentialProtectionAvailability = async (): Promise<boolean | null> => {
  const bridge = netcattyBridge.get();
  if (!bridge?.credentialsAvailable) return null;

  try {
    return await bridge.credentialsAvailable();
  } catch {
    return null;
  }
};
