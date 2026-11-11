/**
 * Pure helpers for the lobby History (records) table. Each row reads as
 * "rider · how fast (km/h) · the race they ran · when". km/h is the one comparable
 * score across races of any length; the RACE column states the course's target
 * (distance for distance races, the clock for time races).
 */
import { kmh, kmhLabel, participantDurationS } from "./speed.js";
import { formatDistance } from "./formatDistance.js";

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Compact a time-of-day label: "6:12 pm" -> "6:12p". Returns '' if unparseable.
export function compactTime(t) {
  const m = String(t || '').match(/^(\d{1,2}:\d{2})\s*([ap])m$/i);
  return m ? `${m[1]}${m[2].toLowerCase()}` : '';
}

/**
 * Relative day label. `todayYmd` (YYYY-MM-DD) is injected so this stays pure and
 * unit-testable — no Date.now() inside. A Date is built only from the injected
 * integers via Date.UTC, so the result is deterministic.
 * @returns {string} "Today" | "Yest" | "May 28" | ''
 */
export function relativeDay(dayYmd, todayYmd) {
  if (!dayYmd || dayYmd === 'unknown') return '';
  if (dayYmd === todayYmd) return 'Today';
  const [y, m, d] = todayYmd.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  const yest = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}-${String(prev.getUTCDate()).padStart(2, '0')}`;
  if (dayYmd === yest) return 'Yest';
  const [, mm, dd] = dayYmd.split('-').map(Number);
  return `${MONTHS[(mm || 1) - 1]} ${dd}`;
}

/**
 * Build a columnar record row from a ghost candidate (participants sorted
 * winner-first; goalLabel already formatted as the course target). The row is
 * about who actually rode: it leads with the top-placed LIVE rider, so a solo
 * ride lost to a ghost (a pace rival, a picked recording) reads as that rider's
 * ride and not as a win for the recording. Everyone else, ghosts included, goes
 * in `others` in placement order. Only a ghost-only race leads with a ghost.
 * (The `winner*` field names are historical: they describe the lead rider.) The
 * row shows the lead's average km/h (distance ÷ duration) as the comparable
 * score, plus the RACE target + its kind (distance/time) so the table can icon
 * it. "when" is split into a day + time so it can stack in a narrow column while
 * showing both.
 */
export function buildRecordRow(g, todayYmd) {
  const participants = Array.isArray(g.participants) ? g.participants : [];
  const winner = participants.find((p) => p && !p.isGhost) || participants[0] || {};
  const durationS = participantDurationS(winner, g.timeCapS);
  const speed = kmh(winner.finalDistanceM, durationS);
  return {
    raceId: g.raceId,
    winnerId: winner.id ?? null,
    winnerName: winner.displayName ?? g.winnerName,
    winnerAvatar: winner.avatarSrc ?? null,
    winnerIsGhost: !!winner.isGhost,
    others: participants.filter((p) => p !== winner).map((p) => ({ id: p.id, displayName: p.displayName, avatarSrc: p.avatarSrc, isGhost: !!p.isGhost })),
    // The lead rider's average pace — the one figure comparable across any race length.
    // null when the race recorded no movement, so the table shows a clean placeholder.
    // A lead rider with no duration (a distance race they did not finish) has
    // no pace, so the cell shows how far they got instead of a blank.
    speedLabel: speed > 0
      ? kmhLabel(winner.finalDistanceM, durationS)
      : (winner.finalDistanceM > 0 ? formatDistance(winner.finalDistanceM) : null),
    // What speedLabel holds, so the table never presents a distance as a speed:
    // 'speed' (km/h), 'distance' (how far a rider who did not finish got), or null.
    speedKind: speed > 0 ? 'speed' : (winner.finalDistanceM > 0 ? 'distance' : null),
    // The course's defining target (distance goal or time cap) + its kind for an icon.
    raceLabel: g.goalLabel,
    raceKind: g.winCondition === 'time' ? 'time' : 'distance',
    whenDay: relativeDay(g.day, todayYmd),
    whenTime: compactTime(g.timeOfDay)
  };
}

export default buildRecordRow;
