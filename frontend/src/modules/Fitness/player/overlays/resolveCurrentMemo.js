/**
 * Resolve the memo the voice-memo overlay should display.
 *
 * Single-source-of-truth rule: when the overlay targets a memo by id, always
 * prefer the LIVE copy from the session's memo list (`voiceMemos`). A "redo"
 * replaces a memo in place (same memoId, new transcript); reading the live copy
 * means the overlay reflects the replacement instead of a stale inline snapshot.
 *
 * The inline `overlayState.memo` is only a fallback for genuinely retroactive
 * memos — the backend response for those doesn't mint a memoId, so a lookup in
 * `voiceMemos` would miss.
 *
 * Bug this fixes (garage, 2026-06-22): after a redo the overlay kept showing the
 * original (replaced) memo because the inline snapshot shadowed the updated list
 * entry — even though only the new memo was persisted.
 *
 * @param {{ memo?: object, memoId?: string|number } | null | undefined} overlayState
 * @param {Array<object>} voiceMemos
 * @returns {object|null}
 */
export function resolveCurrentMemo(overlayState, voiceMemos = []) {
  const list = Array.isArray(voiceMemos) ? voiceMemos : [];

  if (overlayState?.memoId != null) {
    const targetId = String(overlayState.memoId);
    const live = list.find((memo) => memo && String(memo.memoId) === targetId);
    if (live) return live;
  }

  // Retroactive memo with no id in the list — use the inline snapshot.
  if (overlayState?.memo && typeof overlayState.memo === 'object') {
    return overlayState.memo;
  }

  return null;
}
