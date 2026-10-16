import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

interface DebouncedTextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  value: string;
  onCommit: (value: string) => void;
  /** Fires on every keystroke before the debounced commit (e.g. live CSS preview). */
  onDraftChange?: (value: string) => void;
  debounceMs?: number;
}

/**
 * Keeps typing responsive by holding draft text locally and committing upstream
 * after a short pause — avoids re-rendering the full settings tree per keystroke.
 */
export const DebouncedTextarea: React.FC<DebouncedTextareaProps> = ({
  value,
  onCommit,
  onDraftChange,
  debounceMs = 300,
  className,
  ...props
}) => {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const committedRef = useRef(value);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCommitRef = useRef(onCommit);
  const onDraftChangeRef = useRef(onDraftChange);

  onCommitRef.current = onCommit;
  onDraftChangeRef.current = onDraftChange;
  draftRef.current = draft;
  committedRef.current = value;

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    return () => {
      if (commitTimerRef.current) {
        clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
      if (draftRef.current !== committedRef.current) {
        onCommitRef.current(draftRef.current);
      }
    };
  }, []);

  const scheduleCommit = (next: string) => {
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null;
      onCommitRef.current(next);
    }, debounceMs);
  };

  return (
    <textarea
      {...props}
      value={draft}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        onDraftChangeRef.current?.(next);
        scheduleCommit(next);
      }}
      onBlur={() => {
        if (commitTimerRef.current) {
          clearTimeout(commitTimerRef.current);
          commitTimerRef.current = null;
        }
        if (draft !== value) {
          onCommitRef.current(draft);
        }
      }}
      className={cn(className)}
    />
  );
};
