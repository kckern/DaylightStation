import { useCallback, useEffect, useState } from 'react';

const drafts = new Map();

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function clearAdminDraft(ownerKey) {
  drafts.delete(ownerKey);
}

/** Keep an editor's unsaved draft while its route is temporarily unmounted. */
export function useAdminDraftState(ownerKey, initialValue) {
  const [state, setState] = useState(() => {
    const original = clone(initialValue);
    const cached = drafts.get(ownerKey);
    if (cached && same(cached.original, original)) {
      return { original: cached.original, draft: cached.draft };
    }
    drafts.delete(ownerKey);
    return { original, draft: original };
  });

  useEffect(() => {
    if (same(state.draft, state.original)) {
      drafts.delete(ownerKey);
      return;
    }
    drafts.set(ownerKey, { original: clone(state.original), draft: clone(state.draft) });
  }, [ownerKey, state]);

  const setDraft = useCallback((nextDraft) => {
    setState(current => ({
      ...current,
      draft: typeof nextDraft === 'function' ? nextDraft(current.draft) : nextDraft,
    }));
  }, []);

  const setOriginal = useCallback((nextOriginal) => {
    setState(current => ({ ...current, original: clone(nextOriginal) }));
  }, []);

  return [state.draft, setDraft, state.original, setOriginal];
}

export default useAdminDraftState;
