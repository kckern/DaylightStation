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
  const status = day.status === 'over' ? 'over' : 'under';
  const exercise = Number.isFinite(Number(day.exercise)) ? Math.max(0, Number(day.exercise)) : 0;
  return {
    kind: 'day',
    ratio,
    clamped,
    // Rounded to 0.1% so an inline style string is stable and comparable in a
    // test; the eye cannot resolve finer than that on a 40px bar anyway.
    heightPct: Math.round(heightPct * 10) / 10,
    status,
    exercise,
    // The bar deliberately carries TWO denominators: its HEIGHT is food against
    // budget, its HUE is the day's outcome after exercise. That is informative —
    // eating 114% of budget and training it off really is an under day, and
    // collapsing the hue onto the food-only denominator would throw the offset
    // away. What it must never do is present the two as one unexplained claim,
    // so a cell where exercise is the whole difference is FLAGGED, and both the
    // accessible name and a visual cue name the reconciling term.
    offsetByExercise: ratio > 1 && status === 'under',
  };
}

const int = (n) => Math.round(Number(n) || 0);

/**
 * The one accessible sentence for a bar cell.
 *
 * It must not assert "114% of budget" and "under budget" side by side with
 * nothing to reconcile them — that reads as a contradiction, and a reader has
 * no way to discover that exercise is the missing term. So the sentence always
 * states the intake against budget, the exercise, and the outcome, in that
 * order, as one claim.
 *
 * @param {object|null} day - a GET /budget/range entry
 * @param {{kind: string, ratio?: number, status?: string, exercise?: number}} bar
 * @param {string} dayName - the spoken date
 */
export function barCellLabel(day, bar, dayName) {
  if (bar.kind === 'gap') return `${dayName}, no data`;
  const eaten = `ate ${int(day.food)} of ${int(day.budget)} kcal, ${Math.round(bar.ratio * 100)}% of budget`;
  const burned = bar.exercise > 0
    ? `with ${int(bar.exercise)} kcal exercise`
    : 'with no exercise logged';
  const outcome = bar.status === 'over'
    ? `${Math.abs(int(day.remaining))} kcal over budget`
    : `${Math.abs(int(day.remaining))} kcal left`;
  return `${dayName}, ${eaten}, ${burned}, ${outcome}`;
}

/** Compact kcal: 1234 -> "1.2k", 940 -> "940", a gap -> "—". */
export function fmtKcal(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  if (v >= 1000) return `${Math.round(v / 100) / 10}k`;
  return `${Math.round(v)}`;
}
