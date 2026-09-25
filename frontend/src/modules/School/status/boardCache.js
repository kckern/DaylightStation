/**
 * The status board's last-known picture, kept in localStorage so a reload (or
 * a kiosk that wakes its screen) paints the board it last showed instead of
 * four shimmering skeletons. The reads behind the board cost seconds — term and
 * agenda-preview each run to 2-4 s on the homeserver — and a wall fixture that
 * blanks for that long every time it is looked at reads as broken.
 *
 * It is a PAINT cache, never a source of truth: every snapshot is re-read from
 * the server as soon as the board mounts, and each card is replaced in place
 * when its read lands. Only settled cards are written; a card still in flight
 * keeps whatever the snapshot already held for it.
 *
 * The day's discs belong to one study day. The snapshot records which, and the
 * board drops them the moment the server names a different day — yesterday's
 * greens must never stand in for this morning's work. The term grid and ring
 * count are not day-scoped the same way and survive the rollover until their
 * own reads replace them.
 *
 * Storage can be missing or throw (private window, quota, cleared site data);
 * every access is guarded and a failure only means the board paints cold.
 */

const KEY = 'daylight.school.status-board.v1';

/** @returns {{studyDay: string|null, learners: Object<string, {summary?: object|null, term?: object|null}>, rings: object}|null} */
export function readBoardCache(storage = safeStorage()) {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.learners !== 'object') return null;
    return {
      studyDay: typeof parsed.studyDay === 'string' ? parsed.studyDay : null,
      learners: parsed.learners ?? {},
      rings: parsed.rings && typeof parsed.rings === 'object' ? parsed.rings : {},
    };
  } catch {
    return null;
  }
}

/**
 * Merge the board's settled state over the stored snapshot. A learner absent
 * from `learners` keeps its stored entry; a field left `undefined` (still in
 * flight) keeps its stored value.
 */
export function writeBoardCache({ studyDay, learners = {}, rings } = {}, storage = safeStorage()) {
  if (!studyDay) return;
  try {
    const previous = readBoardCache(storage);
    const sameDay = previous?.studyDay === studyDay;
    const merged = {};
    for (const [id, entry] of Object.entries(previous?.learners ?? {})) {
      // Another day's discs are dropped; its term grid is still the best we have.
      merged[id] = sameDay ? { ...entry } : { term: entry.term };
    }
    for (const [id, entry] of Object.entries(learners)) {
      merged[id] = { ...merged[id] };
      if (entry.summary !== undefined) merged[id].summary = entry.summary;
      if (entry.term !== undefined) merged[id].term = entry.term;
    }
    storage?.setItem(KEY, JSON.stringify({
      studyDay,
      learners: merged,
      rings: rings ?? previous?.rings ?? {},
      savedAt: new Date().toISOString(),
    }));
  } catch {
    // Quota or a blocked store: the board simply paints cold next time.
  }
}

function safeStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const BOARD_CACHE_KEY = KEY;
