/**
 * A child's wins for the weekly showcase: what they EARNED, never what they hold.
 *
 * Pure. The economy ledger rows and the window instants are handed in; nothing
 * here reads a clock, a file or another app's code.
 *
 * Earned = `earn` and `prize` rows with a positive delta, in silver or gems.
 * Spends, conversions (a convert pair is a move between currencies, not a win),
 * deposits, gold, passes and plain adjustments do not count. A grown-up's
 * reversal (`adjust` under `reverse:<ref>`, the economy's convention) takes
 * back what it reversed, from the bucket the reversed earn sits in.
 */

const COUNTED_KINDS = new Set(['earn', 'prize']);
const CURRENCIES = ['silver', 'gems'];
// Mirrors the economy's REVERSE_PREFIX; weekly review may not import economy code.
const REVERSE_PREFIX = 'reverse:';
const BOUNDARY_HOUR = 4;

/** Offset of `timezone` from UTC at `instantMs`, in ms (local = utc + offset). */
function offsetMs(instantMs, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/** The instant of `hour`:00 local on `day` (YYYY-MM-DD) in `timezone`. */
function localInstant(day, hour, timezone) {
  const guess = Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);
  const first = guess - offsetMs(guess, timezone);
  return guess - offsetMs(first, timezone);
}

function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The review window as instants on the household's 4am study-day boundary:
 * `[04:00 local on the first date, 04:00 local the day after the last)`.
 * @param {string[]} dates YYYY-MM-DD, ascending
 * @returns {{ startMs: number, endMs: number }|null}
 */
export function studyWindowInstants(dates, timezone = 'UTC', boundaryHour = BOUNDARY_HOUR) {
  if (!Array.isArray(dates) || dates.length === 0) return null;
  return {
    startMs: localInstant(dates[0], boundaryHour, timezone),
    endMs: localInstant(addDays(dates[dates.length - 1], 1), boundaryHour, timezone),
  };
}

const zero = () => ({ silver: 0, gems: 0 });

/**
 * @param {object[]|null} rows ledger rows, any order
 * @param {{ startMs: number, endMs: number }} window half-open
 * @returns {{ week: {silver: number, gems: number}, allTime: {silver: number, gems: number} }}
 */
export function sumEarned(rows, { startMs, endMs }) {
  const week = zero();
  const allTime = zero();
  const earnedInWeek = new Map(); // `${currency}\u0000${ref}` -> in week?
  const list = Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object') : [];

  const currencyOf = (r) => r.currency ?? 'silver';
  const inWeek = (r) => {
    const ms = Date.parse(r.at ?? '');
    return Number.isFinite(ms) && ms >= startMs && ms < endMs;
  };

  for (const r of list) {
    const currency = currencyOf(r);
    if (!COUNTED_KINDS.has(r.kind) || !CURRENCIES.includes(currency)) continue;
    if (!Number.isFinite(r.delta) || r.delta <= 0) continue;
    const thisWeek = inWeek(r);
    allTime[currency] += r.delta;
    if (thisWeek) week[currency] += r.delta;
    if (typeof r.ref === 'string' && r.ref) {
      const key = `${currency}\u0000${r.ref}`;
      if (!earnedInWeek.has(key)) earnedInWeek.set(key, thisWeek);
    }
  }

  for (const r of list) {
    const currency = currencyOf(r);
    if (r.kind !== 'adjust' || !CURRENCIES.includes(currency)) continue;
    if (typeof r.ref !== 'string' || !r.ref.startsWith(REVERSE_PREFIX)) continue;
    if (!Number.isFinite(r.delta) || r.delta >= 0) continue;
    const key = `${currency}\u0000${r.ref.slice(REVERSE_PREFIX.length)}`;
    if (!earnedInWeek.has(key)) continue;
    allTime[currency] = Math.max(0, allTime[currency] + r.delta);
    if (earnedInWeek.get(key)) week[currency] = Math.max(0, week[currency] + r.delta);
  }

  return { week, allTime };
}

/** Whether a child has anything to celebrate this week (any week figure above zero). */
export function hasWeekWins(wins) {
  const week = wins?.week;
  if (!week || typeof week !== 'object') return false;
  return Object.values(week).some((v) => Number.isFinite(v) && v > 0);
}
