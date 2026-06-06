/**
 * Personal-best "high scores" derived from saved races. Two speed categories —
 * fastest average km/h for short efforts (under 5 min) and for long efforts
 * (5 min and over) — each pointing at the race that set it so the lobby can open
 * that race's recap on tap (same affordance as a History row).
 *
 * Only LIVE performances count — ghost participants are replays of an already-
 * counted ride, so they're skipped (matches the only-live-riders rule used in
 * the ghost roster). Pure + injection-free for unit testing.
 */
import { relativeDay, compactTime } from './recordRow.js';

// The split between the "short" and "long" effort categories.
const SHORT_EFFORT_MAX_S = 5 * 60; // 5 minutes

// Average speed in km/h from metres covered over seconds elapsed.
function kmh(distanceM, durationS) {
  return (distanceM / durationS) * 3.6;
}

/**
 * @param {Array} candidates ghost candidates (each with participants[] carrying
 *   finalDistanceM / finalTimeS / isGhost / displayName / avatarSrc, the race's
 *   timeCapS, day / timeOfDay).
 * @param {string} [todayYmd] today's date (YYYY-MM-DD) for relative day labels.
 * @returns {Array<{key,label,valueLabel,raceId,holderName,holderAvatar,whenDay,whenTime}>}
 *   At most one entry per category, in display order. Empty when no live data.
 */
export function buildHighScores(candidates = [], todayYmd) {
  let sprint = null;    // fastest under 5 min  { value(km/h), raceId, holderName, holderAvatar, day, timeOfDay }
  let endurance = null; // fastest 5 min and over
  (Array.isArray(candidates) ? candidates : []).forEach((c) => {
    const capS = Number.isFinite(c.timeCapS) ? c.timeCapS : null;
    (c.participants || []).forEach((p) => {
      if (p.isGhost) return; // replays don't set new records
      const distanceM = Number(p.finalDistanceM);
      // A finisher's own time is the truest duration; for time-capped races nobody
      // "finishes" so we fall back to the cap (the wall-clock everyone rode).
      const durationS = Number.isFinite(p.finalTimeS) ? p.finalTimeS : capS;
      if (!(distanceM > 0) || !(durationS > 0)) return;
      const speed = kmh(distanceM, durationS);
      const meta = { value: speed, raceId: c.raceId, holderName: p.displayName, holderAvatar: p.avatarSrc, day: c.day, timeOfDay: c.timeOfDay };
      if (durationS < SHORT_EFFORT_MAX_S) {
        if (!sprint || speed > sprint.value) sprint = meta;
      } else if (!endurance || speed > endurance.value) {
        endurance = meta;
      }
    });
  });
  const fmtSpeed = (v) => `${v.toFixed(1)} km/h`;
  const card = (key, label, r) => ({
    key, label, valueLabel: fmtSpeed(r.value),
    raceId: r.raceId, holderName: r.holderName, holderAvatar: r.holderAvatar,
    whenDay: relativeDay(r.day, todayYmd), whenTime: compactTime(r.timeOfDay)
  });
  const out = [];
  if (sprint) out.push(card('sprint', 'Fastest <5 min', sprint));
  if (endurance) out.push(card('endurance', 'Fastest 5 min+', endurance));
  return out;
}

export default buildHighScores;
