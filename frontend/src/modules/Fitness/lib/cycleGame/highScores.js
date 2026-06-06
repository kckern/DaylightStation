/**
 * Personal-best "high scores" derived from saved races. One card per category,
 * each pointing at the race that set it so the lobby can open that race's recap
 * on tap (same affordance as a History row).
 *
 * Only LIVE performances count — ghost participants are replays of an already-
 * counted ride, so they're skipped (matches the only-live-riders rule used in
 * the ghost roster). Pure + injection-free for unit testing.
 */
import { formatDistance } from './formatDistance.js';
import { relativeDay, compactTime } from './recordRow.js';

// mm:ss clock formatter (same shape the records rail uses for durations).
function fmtClock(s) {
  if (!Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

/**
 * @param {Array} candidates ghost candidates (each with participants[] carrying
 *   finalDistanceM / finalTimeS / isGhost / displayName / avatarSrc, plus the
 *   race's day / timeOfDay).
 * @param {string} [todayYmd] today's date (YYYY-MM-DD) for relative day labels.
 * @returns {Array<{key,label,valueLabel,raceId,holderName,holderAvatar,whenDay,whenTime}>}
 *   At most one entry per category, in display order. Empty when no live data.
 */
export function buildHighScores(candidates = [], todayYmd) {
  let furthest = null; // { value, raceId, holderName, holderAvatar, day, timeOfDay }
  let longest = null;
  (Array.isArray(candidates) ? candidates : []).forEach((c) => {
    (c.participants || []).forEach((p) => {
      if (p.isGhost) return; // replays don't set new records
      const meta = { raceId: c.raceId, holderName: p.displayName, holderAvatar: p.avatarSrc, day: c.day, timeOfDay: c.timeOfDay };
      if (Number.isFinite(p.finalDistanceM) && (!furthest || p.finalDistanceM > furthest.value)) {
        furthest = { value: p.finalDistanceM, ...meta };
      }
      if (Number.isFinite(p.finalTimeS) && (!longest || p.finalTimeS > longest.value)) {
        longest = { value: p.finalTimeS, ...meta };
      }
    });
  });
  const card = (key, label, valueLabel, r) => ({
    key, label, valueLabel,
    raceId: r.raceId, holderName: r.holderName, holderAvatar: r.holderAvatar,
    whenDay: relativeDay(r.day, todayYmd), whenTime: compactTime(r.timeOfDay)
  });
  const out = [];
  if (furthest) out.push(card('distance', 'Furthest', formatDistance(furthest.value), furthest));
  if (longest) out.push(card('time', 'Longest', fmtClock(longest.value), longest));
  return out;
}

export default buildHighScores;
