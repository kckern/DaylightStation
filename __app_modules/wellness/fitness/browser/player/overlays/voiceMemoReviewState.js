/**
 * Pure state helpers for the voice-memo overlay's REVIEW step.
 *
 * Garage, 2026-10-02: a memo recorded from a session's detail page (attached
 * retroactively to a session that had already ended) left the overlay stuck on
 * an empty review panel. The backend now mints a memoId for retroactive memos,
 * and the old review-open code only kept the inline memo when there was NO id —
 * so the overlay held a bare id, the live (active-session) memo list never
 * contains a historical session's memo, the memo-missing guard cleared the id,
 * and the panel had nothing left to render. The memo itself had saved fine.
 */

/**
 * Build the overlay state for opening review on a memo.
 *
 * @param {object} args
 * @param {object|string} args.memoOrId - Memo object (preferred) or memo id.
 * @param {boolean} args.autoAccept
 * @param {{ sessionId?: string|null, onComplete?: Function|null }|null} [args.carry]
 *   Capture-flow fields to keep across the capture → review hand-off: the
 *   historical session the memo belongs to, and the callback that must fire
 *   when the user finishes (e.g. refresh the detail view, finish closing the
 *   player). Replacing overlay state without them silently dropped both.
 * @param {number} [args.now]
 */
export function buildReviewOverlayState({ memoOrId, autoAccept, carry = null, now = Date.now() }) {
  const isObject = Boolean(memoOrId) && typeof memoOrId === 'object';
  const id = isObject ? memoOrId.memoId : memoOrId;
  return {
    open: true,
    mode: 'review',
    memoId: id || null,
    // Always keep the payload we were handed. resolveCurrentMemo still prefers
    // the live list copy by id, so a redo-in-place stays the source of truth.
    memo: isObject ? memoOrId : null,
    autoAccept,
    startedAt: now,
    sessionId: carry?.sessionId ?? null,
    onComplete: carry?.onComplete ?? null,
  };
}

/**
 * True when the overlay targets a memo id that no longer exists anywhere it
 * could be displayed from — neither the live session list nor the inline copy.
 */
export function isOverlayMemoMissing(overlayState, voiceMemos = []) {
  if (!overlayState?.open || overlayState.memoId == null) return false;
  if (overlayState.mode === 'redo') return false;
  const targetId = String(overlayState.memoId);
  const list = Array.isArray(voiceMemos) ? voiceMemos : [];
  if (list.some((memo) => memo && String(memo.memoId) === targetId)) return false;
  // A retroactive memo lives on a historical session, never in the live list.
  if (overlayState.memo && String(overlayState.memo.memoId) === targetId) return false;
  return true;
}
