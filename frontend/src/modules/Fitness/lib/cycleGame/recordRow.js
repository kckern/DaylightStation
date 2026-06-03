/**
 * Pure helpers for the lobby History (records) table. Each saved race has ONE
 * distance value and ONE time value; the goal column is the win condition. These
 * build a columnar row so a value's column declares its kind (distance vs time)
 * instead of the meaning swapping per row.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Compact a time-of-day label: "6:12 pm" -> "6:12p". Returns '' if unparseable.
function compactTime(t) {
  const m = String(t || '').match(/^(\d{1,2}:\d{2})\s*([ap])m$/i);
  return m ? `${m[1]}${m[2].toLowerCase()}` : '';
}

/**
 * Relative "when" label. `todayYmd` is injected (YYYY-MM-DD) so this stays pure
 * and unit-testable — no Date.now() inside.
 * @returns {string} e.g. "Today 6:12p" | "Yest 7:22p" | "May 28 8:00a" | ''
 */
export function relativeWhen(dayYmd, timeOfDay, todayYmd) {
  const tt = compactTime(timeOfDay);
  if (!dayYmd || dayYmd === 'unknown') return '';
  if (dayYmd === todayYmd) return `Today ${tt}`.trim();
  // Yesterday = todayYmd minus one calendar day. Build the Date only from the
  // injected integers via Date.UTC, so the result is deterministic.
  const [y, m, d] = todayYmd.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  const yest = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}-${String(prev.getUTCDate()).padStart(2, '0')}`;
  if (dayYmd === yest) return `Yest ${tt}`.trim();
  const [, mm, dd] = dayYmd.split('-').map(Number);
  return `${MONTHS[(mm || 1) - 1]} ${dd} ${tt}`.trim();
}

/**
 * Build a columnar record row from a ghost candidate (participants sorted
 * winner-first; goalLabel/scoreLabel already formatted).
 */
export function buildRecordRow(g, todayYmd) {
  const isDistance = g.winCondition === 'distance';
  const participants = Array.isArray(g.participants) ? g.participants : [];
  return {
    raceId: g.raceId,
    winnerId: participants[0]?.id ?? null,
    winnerName: g.winnerName,
    winnerAvatar: participants[0]?.avatarSrc ?? null,
    others: participants.slice(1).map((p) => ({ id: p.id, displayName: p.displayName, avatarSrc: p.avatarSrc })),
    distanceLabel: isDistance ? g.goalLabel : g.scoreLabel,
    timeLabel: isDistance ? g.scoreLabel : g.goalLabel,
    goalColumn: isDistance ? 'distance' : 'time',
    when: relativeWhen(g.day, g.timeOfDay, todayYmd)
  };
}

export default buildRecordRow;
