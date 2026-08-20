// frontend/src/modules/Surround/segmentNav.js
//
// What `next` and `previous` MEAN while a segmented piece is playing.
//
// THE DEFECT THIS EXISTS TO END
// -----------------------------
// `next` was the queue's next, always. Pressed during the first movement of the
// Eroica — a one-item queue — it ended the symphony, and the screen restarted it
// ten seconds later. Inside a piece that has segments, `next` is a movement, not
// an item; the queue is where it goes only when the piece has run out of them.
//
// A PURE FUNCTION OF (segments, contentId, position)
// --------------------------------------------------
// Nothing here reads the DOM, the media element or React. It answers with one of
//
//   { kind: 'seek',    seconds, segmentIndex }   -- stay in this file, move the playhead
//   { kind: 'advance', step, reason }            -- today's queue behaviour, and WHY
//
// and the caller does exactly what it says. `reason` exists because the
// fallthrough is the case that will be argued about later: a queue advance that
// ends a piece has to be able to say whether the piece was out of segments or
// never had any.
//
// THE UN-SEGMENTED ITEM IS NOT A SPECIAL CASE
// -------------------------------------------
// It falls out of the same rules, by construction rather than by a flag: an item
// with no segments has nothing to seek forward to, so `next` advances; and for
// `previous` the item IS the segment, starting at 0 — which is precisely today's
// "restart if more than five seconds in, otherwise go back one." An empty
// segment list therefore reproduces the old behaviour without asking whether the
// list is empty.
//
// SEEKS NEVER CROSS A FILE
// ------------------------
// Only segments carrying THIS media item's `contentId` are candidates. In a
// composed container (a season of polonaises, one work per episode) the next
// segment usually lives in the next media item, and the only way to reach it is
// the queue — so that case produces `advance`, which is both correct and the
// same code path as running out of segments entirely.

import { segmentAt } from './segments.js';

/**
 * How long after a segment starts `previous` still means "the one before this".
 *
 * This is the transport's existing restart grace period, lifted out of the
 * literal it used to be in `useMediaKeyboardHandler`'s `previousTrack` and named
 * once. It is not a new rule and there must not be a second copy of it.
 */
export const RESTART_GRACE_SECONDS = 5;

const startOf = (segment) => (Number.isFinite(segment?.start) ? segment.start : undefined);

/** Positions arrive from a media element, which is allowed to have no opinion yet. */
const readPosition = (position) => (Number.isFinite(position) ? position : 0);

/**
 * Where this media item's segments sit in the container's list, and which of
 * them can actually be seeked to.
 *
 * `first`/`last` are indices into the WHOLE list, so `first > 0` means some other
 * part sounds before this one and `last < length - 1` means another sounds after
 * — which is what separates "the container continues in the next file" from "the
 * container is over."
 */
function locateItem(segments, contentId) {
  const list = Array.isArray(segments) ? segments : [];
  const id = String(contentId ?? '');
  const owned = [];
  let first = -1;
  let last = -1;
  for (let i = 0; i < list.length; i += 1) {
    if (String(list[i]?.contentId) !== id) continue;
    if (first === -1) first = i;
    last = i;
    // A segment with no start has no seek target — an untimed segment is a name
    // on the rail, not a place. It still counts towards `first`/`last`, because
    // the item does have segments even if this one cannot be jumped to.
    if (startOf(list[i]) !== undefined) owned.push({ index: i, start: startOf(list[i]) });
  }
  return { list, total: list.length, owned, first, last, hasAny: first !== -1 };
}

/**
 * Seek to the start of the next segment after `position`; failing that, the
 * queue's next item.
 *
 * @param {{ segments?: Array, contentId?: string, position?: number }} input
 * @returns {{ kind: 'seek', seconds: number, segmentIndex: number }
 *          | { kind: 'advance', step: 1, reason: 'no-segments'|'next-part'|'last-segment' }}
 */
export function nextSegmentAction({ segments, contentId, position } = {}) {
  const at = readPosition(position);
  const { owned, last, total, hasAny } = locateItem(segments, contentId);

  // The first segment of this item that has not started yet. On the exact start
  // of a segment, `next` means the one AFTER it — the boundary belongs to the
  // segment that is starting, and you asked to leave it.
  const target = owned.find((s) => s.start > at);
  if (target) return { kind: 'seek', seconds: target.start, segmentIndex: target.index };

  if (!hasAny) return { kind: 'advance', step: 1, reason: 'no-segments' };
  if (last < total - 1) return { kind: 'advance', step: 1, reason: 'next-part' };
  return { kind: 'advance', step: 1, reason: 'last-segment' };
}

/**
 * Restart the current segment if we are well into it; otherwise the start of the
 * previous one; otherwise the queue's previous item.
 *
 * `restart` distinguishes the two seeks, because they are two different user
 * intentions that happen to share a mechanism: `true` means "start this one
 * again", `false` means "go back one". Without it the caller has to re-derive
 * the distinction from the numbers and gets it wrong — a step back to the first
 * movement is a long way from where you were, which looks exactly like a restart
 * if you only measure the distance.
 *
 * @param {{ segments?: Array, contentId?: string, position?: number }} input
 * @returns {{ kind: 'seek', seconds: number, segmentIndex: number, restart: boolean }
 *          | { kind: 'advance', step: -1, reason: 'no-segments'|'prev-part'|'first-segment'|'before-first-segment' }}
 */
export function previousSegmentAction({ segments, contentId, position } = {}) {
  const at = readPosition(position);
  const { list, owned, first, hasAny } = locateItem(segments, contentId);

  // With no segments, the item is one segment that starts at 0 — today's rule,
  // reached by the same arithmetic as every other case below.
  if (!hasAny) {
    return at > RESTART_GRACE_SECONDS
      ? { kind: 'seek', seconds: 0, segmentIndex: -1, restart: true }
      : { kind: 'advance', step: -1, reason: 'no-segments' };
  }

  // Which segment `previous` is measured FROM. While one is sounding this is the
  // settled tie-break's answer (`segmentAt` — a shared offset resolves to the
  // last of them). In dead time nothing is sounding and `segmentAt` rightly says
  // so, but the anchor is still real: the most recent segment to have STARTED.
  // That is what makes the tail after the last segment behave like the last
  // segment rather than like nowhere.
  const sounding = segmentAt({ segments: list, contentId, position: at });
  let anchorAt = -1;
  if (sounding.index !== -1) {
    anchorAt = owned.findIndex((s) => s.index === sounding.index);
  }
  if (anchorAt === -1) {
    for (let i = owned.length - 1; i >= 0; i -= 1) {
      if (owned[i].start <= at) { anchorAt = i; break; }
    }
  }

  // Before this item's first segment has begun. There is nothing to restart, and
  // the honest previous is the queue's — this is the applause at the head of the
  // Eroica, where `previous` means "the item before this one."
  if (anchorAt === -1) return { kind: 'advance', step: -1, reason: 'before-first-segment' };

  const anchor = owned[anchorAt];
  if (at - anchor.start > RESTART_GRACE_SECONDS) {
    return { kind: 'seek', seconds: anchor.start, segmentIndex: anchor.index, restart: true };
  }

  const back = owned[anchorAt - 1];
  if (back) return { kind: 'seek', seconds: back.start, segmentIndex: back.index, restart: false };

  // No earlier segment in THIS file. If an earlier part exists it is a different
  // media item, which only the queue can reach.
  if (first > 0) return { kind: 'advance', step: -1, reason: 'prev-part' };
  return { kind: 'advance', step: -1, reason: 'first-segment' };
}
