/**
 * Pure helpers for the lobby History (records) table. Each saved race has ONE
 * distance value and ONE time value; the goal column is the win condition. These
 * build a columnar row so a value's column declares its kind (distance vs time)
 * instead of the meaning swapping per row.
 */

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
 * winner-first; goalLabel/scoreLabel already formatted). The "when" is split into
 * a day + time so it can stack in a narrow column while showing both.
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
    whenDay: relativeDay(g.day, todayYmd),
    whenTime: compactTime(g.timeOfDay)
  };
}

export default buildRecordRow;
