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

// Items are ordered on the household wall clock, as text keys
// "YYYY-MM-DDTHH:mm:ss". The two sources stamp time differently:
//  - a photo's takenAt is Immich's localDateTime: LOCAL wall-clock time written
//    with a misleading "Z" ("2026-11-21T16:00:00.000Z" means 4 PM at home), so
//    its key is the text with the zone suffix dropped. Parsing it as an instant
//    would shift every photo by the UTC offset.
//  - school work's `at` is a real UTC instant, so its key is that instant on
//    this screen's clock (the TV runs in the household zone). Exactly noon UTC
//    on the study day is the server's "time unknown" placeholder and sorts at
//    local noon instead.
const KEY_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?/;

function wallClockKey(text) {
  const m = KEY_RE.exec(text || '');
  return m ? `${m[1]}${m[2] || ':00'}` : null;
}

const pad = (n) => String(n).padStart(2, '0');

export function localKeyOfInstant(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function sortKeyOf(item) {
  if (item?.type === 'school') {
    const { at, studyDay } = item;
    if (!at) return null;
    if (studyDay && at.replace(/\.0+Z$/, 'Z') === `${studyDay}T12:00:00Z`) return `${studyDay}T12:00:00`;
    return localKeyOfInstant(at);
  }
  return wallClockKey(item?.takenAt);
}

// Stable: keyed items first in key order, then unkeyed items in their
// original relative order.
function byTime(items) {
  return items
    .map((item, i) => ({ item, i, t: sortKeyOf(item) }))
    .sort((a, b) => {
      if (a.t !== null && b.t !== null) return (a.t < b.t ? -1 : a.t > b.t ? 1 : 0) || a.i - b.i;
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
