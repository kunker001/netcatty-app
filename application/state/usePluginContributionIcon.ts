import { useEffect, useState } from 'react';

import { netcattyBridge } from '../../infrastructure/services/netcattyBridge';

type ResolvedIcon = { light: string; dark?: string };
type ResolvedIconState = { requestKey: string; icon: ResolvedIcon } | null;

export function pluginContributionIconRequestKey(
  pluginId: string | undefined,
  icon: NetcattyPluginIconReference | undefined,
): string | null {
  return icon?.kind === 'package' && pluginId
    ? JSON.stringify([pluginId, icon.light, icon.dark ?? null])
    : null;
}

export function selectPluginContributionIcon(
  requestKey: string | null,
  state: ResolvedIconState,
): ResolvedIcon | null {
  return requestKey != null && state?.requestKey === requestKey ? state.icon : null;
}

export function usePluginContributionIcon(
  pluginId: string | undefined,
  icon: NetcattyPluginIconReference | undefined,
): ResolvedIcon | null {
  const requestKey = pluginContributionIconRequestKey(pluginId, icon);
  const [resolved, setResolved] = useState<ResolvedIconState>(null);

  useEffect(() => {
    if (icon?.kind !== 'package' || !pluginId || !requestKey) {
      setResolved(null);
      return;
    }
    let cancelled = false;
    void netcattyBridge.get()?.getPluginContributionIcon?.(pluginId, icon).then((next) => {
      if (!cancelled) setResolved({ requestKey, icon: next });
    }).catch(() => {
      if (!cancelled) setResolved(null);
    });
    return () => { cancelled = true; };
  }, [icon, pluginId, requestKey]);

  return selectPluginContributionIcon(requestKey, resolved);
}
