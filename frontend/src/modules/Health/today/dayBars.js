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

/** How far past budget the bar is allowed to grow before it clamps. */
export const OVERSHOOT_CAP = 1.25;

/**
 * @param {object|null} day - one entry from GET /budget/range
 * @returns {{ kind: 'gap' }|{ kind: 'day', ratio: number, clamped: boolean, heightPct: number, status: 'under'|'over' }}
 *   `heightPct` is a percentage OF THE BAR BOX, whose full height is the
 *   overshoot cap — so a day exactly on budget fills 80% of the box and lands
 *   on the budget reference line, and the 25% above it is headroom that only an
 *   over day uses. `ratio` is the true, unclamped fraction of budget, because
 *   the accessible name must announce the real number even when the paint
 *   clamps (the same rule the macro bars follow).
 */
export function barModel(day) {
  if (!day || day.error || !Number.isFinite(Number(day.budget)) || Number(day.budget) <= 0) {
    return { kind: 'gap' };
  }
  const food = Number(day.food);
  const ratio = (Number.isFinite(food) ? Math.max(0, food) : 0) / Number(day.budget);
  const clamped = ratio > OVERSHOOT_CAP;
  const heightPct = (Math.min(ratio, OVERSHOOT_CAP) / OVERSHOOT_CAP) * 100;
  return {
    kind: 'day',
    ratio,
    clamped,
    // Rounded to 0.1% so an inline style string is stable and comparable in a
    // test; the eye cannot resolve finer than that on a 40px bar anyway.
    heightPct: Math.round(heightPct * 10) / 10,
    status: day.status === 'over' ? 'over' : 'under',
  };
}

/** Compact kcal: 1234 -> "1.2k", 940 -> "940", a gap -> "—". */
export function fmtKcal(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  if (v >= 1000) return `${Math.round(v / 100) / 10}k`;
  return `${Math.round(v)}`;
}
