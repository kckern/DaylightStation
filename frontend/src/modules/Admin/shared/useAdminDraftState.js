import { useCallback, useEffect, useState } from 'react';

const drafts = new Map();

/** Canonical owner key for an in-memory draft scoped to one Admin session. */
export function adminDraftOwnerKey(owner, sessionKey, ...scope) {
  return JSON.stringify([owner, sessionKey, ...scope]);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function clearAdminDraft(ownerKey) {
  drafts.delete(ownerKey);
}

/** Restore a draft only when the server baseline still matches exactly. */
export function restoreAdminDraft(ownerKey, original) {
  const cached = drafts.get(ownerKey);
  if (!cached) return null;
  if (!same(cached.original, original)) {
    drafts.delete(ownerKey);
    return null;
  }
  return { draft: clone(cached.draft) };
}

/** Remember only changed values, so a clean editor never leaves stale cache. */
export function rememberAdminDraft(ownerKey, original, draft) {
  if (same(original, draft)) {
    drafts.delete(ownerKey);
    return;
  }
  drafts.set(ownerKey, { original: clone(original), draft: clone(draft) });
}

/** Move an existing draft to a refreshed server baseline without replacing its edits. */
export function rebaseAdminDraft(ownerKey, original) {
  const cached = drafts.get(ownerKey);
  if (!cached) return false;
  rememberAdminDraft(ownerKey, original, cached.draft);
  return true;
}

/** Acknowledge the submitted revision without erasing a newer cached edit. */
export function acknowledgeAdminDraft(ownerKey, submittedOriginal, submittedDraft, savedOriginal) {
  const cached = drafts.get(ownerKey);
  if (!cached || !same(cached.original, submittedOriginal)) return;
  if (same(cached.draft, submittedDraft)) {
    drafts.delete(ownerKey);
    return;
  }
  const newerDraft = Object.prototype.hasOwnProperty.call(cached.draft, 'expectedRevision')
    ? { ...cached.draft, expectedRevision: savedOriginal.revision ?? null }
    : cached.draft;
  rememberAdminDraft(ownerKey, savedOriginal, newerDraft);
}

/** Keep an editor's unsaved draft while its route is temporarily unmounted. */
export function useAdminDraftState(ownerKey, initialValue) {
  const [state, setState] = useState(() => {
    const original = clone(initialValue);
    const cached = restoreAdminDraft(ownerKey, original);
    return { original, draft: cached ? cached.draft : original };
  });

  useEffect(() => {
    rememberAdminDraft(ownerKey, state.original, state.draft);
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
