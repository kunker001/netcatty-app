import { useCallback, useEffect, useState } from "react";
import { localStorageAdapter } from "../../infrastructure/persistence/localStorageAdapter";

export const useTreeExpandedState = (storageKey: string) => {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    const stored = localStorageAdapter.readString(storageKey);
    if (stored) {
      try {
        const paths = JSON.parse(stored) as string[];
        return new Set(paths);
      } catch {
        return new Set();
      }
    }
    return new Set();
  });

  useEffect(() => {
    const pathsArray = Array.from(expandedPaths);
    localStorageAdapter.writeString(storageKey, JSON.stringify(pathsArray));
  }, [storageKey, expandedPaths]);

  const togglePath = useCallback((path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback((allPaths: string[]) => {
    setExpandedPaths(new Set(allPaths));
  }, []);

  const collapseAll = useCallback(() => {
    setExpandedPaths(new Set());
  }, []);

  const ensurePathExpanded = useCallback((path: string) => {
    setExpandedPaths((current) => {
      if (current.has(path)) return current;
      const next = new Set(current);
      next.add(path);
      return next;
    });
  }, []);

  return {
    expandedPaths,
    togglePath,
    expandAll,
    collapseAll,
    ensurePathExpanded,
  };
};