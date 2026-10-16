import { useCallback, useEffect, useRef, useState } from 'react';
import { STORAGE_KEY_COMPOSE_BAR_PINNED_SNIPPETS } from '../../infrastructure/config/storageKeys';
import { localStorageAdapter } from '../../infrastructure/persistence/localStorageAdapter';

interface PinnedState {
  pinnedIds: string[];
  /** True when the user has never saved pins (localStorage key absent). */
  neverSaved: boolean;
}

function readPinnedState(): PinnedState {
  const stored = localStorageAdapter.read<string[]>(STORAGE_KEY_COMPOSE_BAR_PINNED_SNIPPETS);
  if (stored === null) {
    return { pinnedIds: [], neverSaved: true };
  }
  return {
    pinnedIds: Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : [],
    neverSaved: false,
  };
}

function parseSnippetIdKey(snippetIdKey?: string): Set<string> | null {
  if (!snippetIdKey) return null;
  const ids = snippetIdKey.split('\0').filter(Boolean);
  if (ids.length === 0) return null;
  return new Set(ids);
}

/**
 * Persisted snippet IDs shown on the terminal compose bar quick strip.
 * Pass a stable `snippetIdKey` (`ids.join('\\0')`) to prune pins for deleted snippets.
 * On first run, `defaultSeedIds` are written once when pins were never saved.
 */
export function useComposeBarPinnedSnippets(
  snippetIdKey?: string,
  defaultSeedIds?: readonly string[],
) {
  const [{ pinnedIds, neverSaved }, setPinnedState] = useState(readPinnedState);
  const skipNextPersistRef = useRef(true);
  const needsSeedRef = useRef(neverSaved);

  const setPinnedIds = useCallback((updater: string[] | ((prev: string[]) => string[])) => {
    setPinnedState((prev) => {
      const nextIds = typeof updater === 'function' ? updater(prev.pinnedIds) : updater;
      return { pinnedIds: nextIds, neverSaved: false };
    });
  }, []);

  useEffect(() => {
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    localStorageAdapter.write(STORAGE_KEY_COMPOSE_BAR_PINNED_SNIPPETS, pinnedIds);
  }, [pinnedIds]);

  useEffect(() => {
    if (!needsSeedRef.current) return;

    const seed = defaultSeedIds?.filter(Boolean).slice(0, 4) ?? [];
    if (seed.length === 0) return;

    const applySeed = () => {
      if (!needsSeedRef.current) return;
      needsSeedRef.current = false;
      setPinnedState({ pinnedIds: [...seed], neverSaved: false });
    };

    const isBuiltinSeed = seed.every((id) => id.startsWith('__compose_builtin_'));
    if (!isBuiltinSeed) {
      applySeed();
      return;
    }

    // Brief delay so vault snippets can load before falling back to built-ins.
    const timer = setTimeout(applySeed, 300);
    return () => clearTimeout(timer);
  }, [defaultSeedIds]);

  useEffect(() => {
    const valid = parseSnippetIdKey(snippetIdKey);
    if (!valid) return;
    setPinnedIds((prev) => {
      const next = prev.filter((id) => valid.has(id) || id.startsWith('__compose_builtin_'));
      return next.length === prev.length ? prev : next;
    });
  }, [snippetIdKey, setPinnedIds]);

  const pin = useCallback((id: string) => {
    setPinnedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, [setPinnedIds]);

  const unpin = useCallback((id: string) => {
    setPinnedIds((prev) => prev.filter((x) => x !== id));
  }, [setPinnedIds]);

  const toggle = useCallback((id: string) => {
    setPinnedIds((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
  }, [setPinnedIds]);

  const isPinned = useCallback((id: string) => pinnedIds.includes(id), [pinnedIds]);

  return { pinnedIds, pin, unpin, toggle, isPinned };
}
