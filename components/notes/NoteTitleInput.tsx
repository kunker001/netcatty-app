import React, { useEffect, useRef, useState } from "react";
import {
  resolveSupersededImeInputEvent,
  shouldAdoptExternalImeControlledValue,
  shouldCommitImeControlledChange,
} from "../../domain/imeControlledInput";

type NoteTitleInputProps = {
  noteId: string;
  value: string;
  placeholder?: string;
  className?: string;
  /** Commit into parent draft state (may rewrite controlled value). Idle IME only. */
  onCommit: (title: string) => void;
  /**
   * Stash title for crash/teardown flush without updating controlled React state.
   * Called during IME composition so pagehide/note-switch can persist without
   * fighting the composition buffer.
   */
  onLiveDraft?: (title: string) => void;
  onBlur?: () => void;
};

/**
 * Controlled note-title field that does not push parent updates during CJK IME
 * composition. Immediate `value={external}` writes mid-composition break Windows
 * IMEs such as Sogou Wubi (candidate dismiss / no committed text).
 */
export const NoteTitleInput: React.FC<NoteTitleInputProps> = ({
  noteId,
  value,
  placeholder,
  className,
  onCommit,
  onLiveDraft,
  onBlur,
}) => {
  const [draft, setDraft] = useState(value);
  const composingRef = useRef(false);
  const valueAtComposeStartRef = useRef(value);
  const supersededRef = useRef(false);
  const noteIdRef = useRef(noteId);

  const onLiveDraftRef = useRef(onLiveDraft);
  onLiveDraftRef.current = onLiveDraft;

  useEffect(() => {
    if (noteIdRef.current !== noteId) {
      noteIdRef.current = noteId;
      composingRef.current = false;
      supersededRef.current = false;
      setDraft(value);
      return;
    }

    let adoptedExternal: string | null = null;
    setDraft((draftValue) => {
      const composing = composingRef.current;
      const shouldAdopt = shouldAdoptExternalImeControlledValue({
        isComposingSession: composing,
        draftValue,
        externalValue: value,
        valueAtComposeStart: composing ? valueAtComposeStartRef.current : undefined,
      });
      if (shouldAdopt && composing && value !== valueAtComposeStartRef.current) {
        supersededRef.current = true;
        adoptedExternal = value;
      }
      return shouldAdopt ? value : draftValue;
    });
    if (adoptedExternal !== null) {
      onLiveDraftRef.current?.(adoptedExternal);
    }
  }, [noteId, value]);

  const commit = (next: string) => {
    composingRef.current = false;
    supersededRef.current = false;
    setDraft(next);
    onCommit(next);
  };

  return (
    <input
      data-note-title-input="true"
      className={className}
      value={draft}
      placeholder={placeholder}
      onBlur={(event) => {
        // Blur finalizes IME. Sync parent before flushNoteDraft so composition-only
        // titles and superseded external adoptions both land in draftTitleRef.
        composingRef.current = false;
        if (supersededRef.current) {
          supersededRef.current = false;
          setDraft(value);
          onCommit(value);
        } else {
          const next = event.currentTarget.value;
          setDraft(next);
          onCommit(next);
        }
        onBlur?.();
      }}
      onChange={(event) => {
        const superseded = resolveSupersededImeInputEvent({
          compositionExternallySuperseded: supersededRef.current,
          isComposingSession: composingRef.current,
          nativeEventIsComposing: event.nativeEvent.isComposing,
        });
        if (superseded.ignoreEventValue) {
          if (superseded.clearSupersedeLatch) {
            supersededRef.current = false;
          }
          setDraft(value);
          return;
        }

        const next = event.target.value;
        setDraft(next);
        // Always stash for teardown/note-switch flush; do not fight IME via onCommit.
        onLiveDraft?.(next);
        if (
          shouldCommitImeControlledChange({
            isComposingSession: composingRef.current,
            nativeEventIsComposing: event.nativeEvent.isComposing,
            compositionExternallySuperseded: supersededRef.current,
          })
        ) {
          onCommit(next);
        }
      }}
      onCompositionStart={() => {
        composingRef.current = true;
        supersededRef.current = false;
        valueAtComposeStartRef.current = value;
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        if (value !== valueAtComposeStartRef.current || supersededRef.current) {
          supersededRef.current = true;
          setDraft(value);
          // Drop any live-stashed composed text so teardown flush cannot persist
          // the rejected IME draft over the authoritative external title.
          onLiveDraft?.(value);
          window.setTimeout(() => {
            if (supersededRef.current && !composingRef.current) {
              supersededRef.current = false;
            }
          }, 0);
          return;
        }
        commit(event.currentTarget.value);
      }}
    />
  );
};
