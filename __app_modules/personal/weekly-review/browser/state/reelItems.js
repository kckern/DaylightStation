// The reel a day plays: its photos and videos, plus the day's curated school
// work (day.school), as one list ordered by time.
//
// Memoized per day object so the keymap context (WeeklyReview's mediaCtx) and
// the reel render read the SAME array: an index computed by one always points
// at the item the other draws. Bootstrap payloads are replaced wholesale on a
// window load, never mutated, so a WeakMap on the day object is safe.
//
// Extension seam: `extras` are appended after the time-ordered items and are
// not sorted into them (Task 7's end-of-window showcase uses this). Calls with
// extras are not memoized, so callers that pass them must memoize themselves.

const cache = new WeakMap();

export function schoolReelItem(work) {
  return {
    ...work,
    type: 'school',
    id: `school:${work.learnerId}:${work.groupKey}:${work.studyDay}`,
    takenAt: work.at,
  };
}

// Stable time sort: dated items by instant, undated items after them in their
// original relative order. Compared as instants, not text: a photo's takenAt
// is Immich's offset-less local wall clock ("2026-06-22T14:25:13", which Date
// reads as local time) while school work carries UTC ISO ("...T22:12:00Z").
function timeOf(item) {
  const ms = item?.takenAt ? Date.parse(item.takenAt) : NaN;
  return Number.isNaN(ms) ? null : ms;
}

function byTime(items) {
  return items
    .map((item, i) => ({ item, i, t: timeOf(item) }))
    .sort((a, b) => {
      if (a.t !== null && b.t !== null) return a.t - b.t || a.i - b.i;
      if (a.t !== null) return -1;
      if (b.t !== null) return 1;
      return a.i - b.i;
    })
    .map(({ item }) => item);
}

export function reelItemsForDay(day, extras) {
  if (!day) return extras?.length ? [...extras] : [];
  let base = cache.get(day);
  if (!base) {
    base = byTime([...(day.photos || []), ...(day.school || []).map(schoolReelItem)]);
    cache.set(day, base);
  }
  return extras?.length ? [...base, ...extras] : base;
}
