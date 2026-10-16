import { useCallback, useEffect, useRef, useState } from 'react';

export const TAB_ENTER_ANIMATION_MS = 220;

export function useTopTabLifecycleAnimations(orderedTabs: string[]) {
  const prevTabIdsRef = useRef<Set<string>>(new Set());
  const [enteringTabIds, setEnteringTabIds] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    const current = new Set(orderedTabs);
    const prev = prevTabIdsRef.current;
    const added = orderedTabs.filter((tabId) => !prev.has(tabId));
    prevTabIdsRef.current = current;

    if (added.length === 0) return;

    setEnteringTabIds(new Set(added));
    const timer = window.setTimeout(() => {
      setEnteringTabIds(new Set());
    }, TAB_ENTER_ANIMATION_MS);
    return () => window.clearTimeout(timer);
  }, [orderedTabs]);

  const getTabAnimationClass = useCallback((tabId: string) => {
    if (enteringTabIds.has(tabId)) return 'top-tab-enter';
    return undefined;
  }, [enteringTabIds]);

  return { getTabAnimationClass };
};
