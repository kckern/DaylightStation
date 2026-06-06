/**
 * Pure helpers for the lobby History (records) table. Each row reads as
 * "rider · how fast (km/h) · the race they ran · when". km/h is the one comparable
 * score across races of any length; the RACE column states the course's target
 * (distance for distance races, the clock for time races).
 */
import { kmh, kmhLabel, participantDurationS } from './speed.js';

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
 * winner-first; goalLabel already formatted as the course target). The row shows
 * the WINNER's average km/h (distance ÷ duration) as the comparable score, plus the
 * RACE target + its kind (distance/time) so the table can icon it. "when" is split
 * into a day + time so it can stack in a narrow column while showing both.
 */
export function buildRecordRow(g, todayYmd) {
  const participants = Array.isArray(g.participants) ? g.participants : [];
  const winner = participants[0] || {};
  const durationS = participantDurationS(winner, g.timeCapS);
  const speed = kmh(winner.finalDistanceM, durationS);
  return {
    raceId: g.raceId,
    winnerId: winner.id ?? null,
    winnerName: g.winnerName,
    winnerAvatar: winner.avatarSrc ?? null,
    winnerIsGhost: !!winner.isGhost,
    others: participants.slice(1).map((p) => ({ id: p.id, displayName: p.displayName, avatarSrc: p.avatarSrc, isGhost: !!p.isGhost })),
    // Winner's average pace — the one figure comparable across any race length.
    // null when the race recorded no movement, so the table shows a clean placeholder.
    speedLabel: speed > 0 ? kmhLabel(winner.finalDistanceM, durationS) : null,
    // The course's defining target (distance goal or time cap) + its kind for an icon.
    raceLabel: g.goalLabel,
    raceKind: g.winCondition === 'time' ? 'time' : 'distance',
    whenDay: relativeDay(g.day, todayYmd),
    whenTime: compactTime(g.timeOfDay)
  };
}

export default buildRecordRow;
