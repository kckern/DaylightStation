//
// The bar geometry shared by every budget-range bar surface (the week strip,
// the desktop month block). Pure arithmetic, deliberately in its own file:
// jsdom cannot measure a rendered bar, so what a test CAN pin is the number the
// component computes and sets — which means that number has to be a function
// somebody can call.
//
// THE HONESTY RULE (PRD F7.1). A day the server could not compute is a GAP, and
// a gap is not a zero. Rendering "no data" as a zero-height bar says "you ate
// nothing", which is the same class of lie as a confident `0 / 30 g` fibre bar.
// `barModel` therefore has three outcomes, not two, and a genuine zero day is
// distinguishable from a hole: the zero day has a real track and a real (empty)
// fill, the gap day has neither and renders hollow.

/** The least headroom past the goal a bar box gets. */
export const OVERSHOOT_CAP = 1.25;
/** Room above the highest break-even mark, and the most headroom a box ever gets. */
const BREAK_EVEN_HEADROOM = 1.1;
const MAX_CAP = 2;

const finiteOr = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const breakEvenRatio = day => (finiteOr(day?.maintenance) > 0 && finiteOr(day?.budget) > 0 ? Number(day.maintenance) / Number(day.budget) : 0);

/**
 * One box height for a whole strip, so every cell's goal and break-even lines
 * sit at the same place: the overshoot cap, raised far enough that the highest
 * break-even mark in the range fits under the top.
 */
export function barScale(days) {
  const highest = Math.max(0, ...(days || []).map(breakEvenRatio));
  return Math.min(MAX_CAP, Math.max(OVERSHOOT_CAP, highest * BREAK_EVEN_HEADROOM));
}

const pct1 = v => Math.round(v * 1000) / 10;

/**
 * @param {object|null} day - one entry from GET /budget/range
 * @param {number} [cap] - the box height as a multiple of the goal (barScale)
 * @returns {{ kind: 'gap' }|{ kind: 'day', ratio, clamped, heightPct, goalPct, breakEvenPct, status, zone, exercise, net }}
 *   The bar is NET calories (food − exercise) against the day's goal — the
 *   same quantity the Today bar fills, and the same one the server's status
 *   judges, so height and hue can never disagree. `heightPct`, `goalPct` and
 *   `breakEvenPct` are percentages OF THE BAR BOX, whose full height is `cap`
 *   goals. `ratio` is the true, unclamped fraction of goal, because the
 *   accessible name must announce the real number even when the paint clamps.
 *   `zone`: under (≤ goal), deficit (past goal, still under break-even —
 *   losing, just slower), surplus (past break-even, or past goal with no
 *   break-even known).
 */
export function barModel(day, cap = OVERSHOOT_CAP) {
  if (!day || day.error || day.loggingStatus === 'unlogged' || !Number.isFinite(Number(day.budget)) || Number(day.budget) <= 0) {
    return { kind: 'gap' };
  }
  const goal = Number(day.budget);
  const food = Math.max(0, finiteOr(day.food));
  const exercise = Math.max(0, finiteOr(day.exercise));
  const net = Math.max(0, food - exercise);
  const ratio = net / goal;
  const even = breakEvenRatio(day);
  const zone = ratio <= 1 ? 'under' : even > 1 && ratio <= even ? 'deficit' : 'surplus';
  return {
    kind: 'day',
    ratio,
    clamped: ratio > cap,
    // Rounded to 0.1% so an inline style string is stable and comparable in a
    // test; the eye cannot resolve finer than that on a 40px bar anyway.
    heightPct: pct1(Math.min(ratio, cap) / cap),
    goalPct: pct1(1 / cap),
    breakEvenPct: even > 0 && even <= cap ? pct1(even / cap) : null,
    status: day.status === 'over' ? 'over' : 'under',
    zone,
    exercise,
    net,
  };
}

const int = (n) => Math.round(Number(n) || 0);

/**
 * The one accessible sentence for a bar cell: what was eaten, what was burned,
 * the net that the bar draws against the goal, break-even when known, and the
 * outcome — as one claim, so every number the picture uses is named.
 *
 * @param {object|null} day - a GET /budget/range entry
 * @param {{kind: string, ratio?: number, exercise?: number, net?: number}} bar
 * @param {string} dayName - the spoken date
 */
export function barCellLabel(day, bar, dayName) {
  if (bar.kind === 'gap') return `${dayName}, no data`;
  const burned = bar.exercise > 0 ? `burned ${int(bar.exercise)}` : 'no exercise logged';
  const net = `${int(bar.net)} net of ${int(day.budget)} kcal goal, ${Math.round(bar.ratio * 100)}%`;
  const even = finiteOr(day.maintenance) > 0 ? `, break even ${int(day.maintenance)}` : '';
  const outcome = day.status === 'over'
    ? `${Math.abs(int(day.remaining))} kcal over goal`
    : `${Math.abs(int(day.remaining))} kcal left`;
  return `${dayName}, ate ${int(day.food)}, ${burned}, ${net}${even}, ${outcome}`;
}

/** Compact kcal: 1234 -> "1.2k", 940 -> "940", a gap -> "—". */
export function fmtKcal(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  if (v >= 1000) return `${Math.round(v / 100) / 10}k`;
  return `${Math.round(v)}`;
}
