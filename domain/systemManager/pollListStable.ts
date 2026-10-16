function pollSnapshotEqual<T>(prev: T | null, next: T): boolean {
  if (prev === next) return true;
  if (prev === null) return false;
  try {
    return JSON.stringify(prev) === JSON.stringify(next);
  } catch {
    return false;
  }
}

function itemSnapshotEqual<T>(a: T, b: T): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** Skip React state updates when polled payload is unchanged. */
export function nextPollData<T>(prev: T | null, next: T): T {
  return pollSnapshotEqual(prev, next) ? prev as T : next;
}

/**
 * Merge polled list rows by key, reusing previous item references when unchanged.
 * Keeps React.memo row components from re-rendering when other rows update.
 */
export function mergePollListByKey<T, K extends string | number>(
  prev: T[] | null,
  next: T[],
  getKey: (item: T) => K,
  isEqual: (a: T, b: T) => boolean = itemSnapshotEqual,
): T[] {
  if (prev === null) return next;
  if (prev.length !== next.length) return next;

  const nextByKey = new Map(next.map((item) => [getKey(item), item]));
  if (prev.some((item) => !nextByKey.has(getKey(item)))) return next;
  if (next.some((item) => !prev.some((p) => getKey(p) === getKey(item)))) return next;

  let changed = false;
  const merged = prev.map((oldItem) => {
    const newItem = nextByKey.get(getKey(oldItem))!;
    if (isEqual(oldItem, newItem)) return oldItem;
    changed = true;
    return newItem;
  });
  return changed ? merged : prev;
}
