// "Keep similar things playing" (RQ-STEER-19, owner decision O2 as revised).
//
// Pure selection policy shared by every queue owner. Callers resolve the
// container (siblings / show / artist, never the library fallback) and its
// playable items in NATURAL order, each with the household-wide `lastPlayed`
// (MediaProgress) where one exists; this module picks the next batch.
//
// Preference order — the 7-day rule is a preference, never a gate:
//   1. never-played items after the finished one, in natural order
//   2. items not played within 7 days, natural order starting after the
//      finished one (wrapping)
//   3. everything else, least-recently-played first (the same ordering as
//      backend recencyOrder.orderWatchedByRecency with shuffle off)
// A playlist is never wrapped or re-ordered: the rest of it, then stop.
// Excluded: the finished item, anything already queued, anything playing on
// another screen. Batches stop at `maxItems` or once `maxSeconds` is reached.

export const AUTO_CONTINUE_ADDED_BY = 'auto-continue';
export const AUTO_CONTINUE_BATCH_MAX_ITEMS = 5;
export const AUTO_CONTINUE_BATCH_MAX_SECONDS = 30 * 60;
export const RECENTLY_PLAYED_MS = 7 * 24 * 60 * 60 * 1000;

const idOf = (item) => item?.contentId ?? item?.id ?? null;
const playedAt = (item) => {
  const t = item?.lastPlayed ? Date.parse(item.lastPlayed) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** True when a resolved parent is the adapter's whole-library fallback, not a container. */
export function isLibraryFallbackParent(parent) {
  const id = String(parent?.id ?? '');
  return !id || id.startsWith('library:') || /^[a-z0-9-]+:library:/i.test(id);
}

/**
 * @param {object} opts
 * @param {Array<object>} opts.items        container items, natural order, playable
 * @param {string} opts.finishedId          contentId of the item that just ended
 * @param {'container'|'playlist'} [opts.kind]
 * @param {Iterable<string>} [opts.exclude] contentIds never to add
 * @param {number} opts.now                 epoch ms
 * @returns {Array<object>} the batch, in play order
 */
export function selectContinuationBatch({
  items, finishedId, kind = 'container', exclude = [], now,
  maxItems = AUTO_CONTINUE_BATCH_MAX_ITEMS, maxSeconds = AUTO_CONTINUE_BATCH_MAX_SECONDS,
}) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const excluded = new Set([finishedId, ...exclude].filter(Boolean));
  const index = items.findIndex((item) => idOf(item) === finishedId);
  const after = index >= 0 ? items.slice(index + 1) : items;
  const before = index >= 0 ? items.slice(0, index) : [];
  const usable = (item) => idOf(item) && !excluded.has(idOf(item)) && item?.isLive !== true;

  let ordered;
  if (kind === 'playlist') {
    ordered = after.filter(usable);
  } else {
    const wrapped = [...after, ...before].filter(usable);
    const never = wrapped.filter((item) => playedAt(item) == null && after.includes(item));
    const stale = wrapped.filter((item) => !never.includes(item)
      && (playedAt(item) == null || now - playedAt(item) >= RECENTLY_PLAYED_MS));
    const rest = wrapped.filter((item) => !never.includes(item) && !stale.includes(item))
      .sort((a, b) => playedAt(a) - playedAt(b));
    ordered = [...never, ...stale, ...rest];
  }

  const batch = [];
  let seconds = 0;
  const seen = new Set();
  for (const item of ordered) {
    if (batch.length >= maxItems || seconds >= maxSeconds) break;
    if (seen.has(idOf(item))) continue;
    seen.add(idOf(item));
    batch.push(item);
    seconds += Number.isFinite(item.duration) ? item.duration : 0;
  }
  return batch;
}
