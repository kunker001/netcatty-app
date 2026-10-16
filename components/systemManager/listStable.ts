import { useMemo, useRef } from 'react';

export {
  mergePollListByKey,
  nextPollData,
} from '../../domain/systemManager/pollListStable';

/**
 * Keep list row order stable across poll refreshes.
 * Re-sorts only when sortToken changes (sort / filter / search), or when items are added/removed.
 */
export function useStableListOrder<T, K extends string | number>(
  items: T[],
  getKey: (item: T) => K,
  sortToken: string,
  compare: (a: T, b: T) => number,
): T[] {
  const orderRef = useRef<K[]>([]);
  const lastSortTokenRef = useRef('');
  const lastMembershipRef = useRef('');
  const outputRef = useRef<T[]>([]);

  return useMemo(() => {
    const byKey = new Map(items.map((item) => [getKey(item), item]));
    const membership = [...items.map(getKey)].sort().join('|');

    if (sortToken !== lastSortTokenRef.current || membership !== lastMembershipRef.current) {
      lastSortTokenRef.current = sortToken;
      lastMembershipRef.current = membership;
      orderRef.current = [...items].sort(compare).map(getKey);
    } else {
      const alive = new Set(items.map(getKey));
      orderRef.current = orderRef.current.filter((key) => alive.has(key));
      for (const item of items) {
        const key = getKey(item);
        if (!orderRef.current.includes(key)) {
          orderRef.current.push(key);
        }
      }
    }

    const nextOutput = orderRef.current
      .map((key) => byKey.get(key))
      .filter((item): item is T => item !== undefined);

    const prevOutput = outputRef.current;
    if (
      nextOutput.length === prevOutput.length
      && nextOutput.every((item, index) => item === prevOutput[index])
    ) {
      return prevOutput;
    }

    outputRef.current = nextOutput;
    return nextOutput;
  }, [items, sortToken, compare, getKey]);
}
