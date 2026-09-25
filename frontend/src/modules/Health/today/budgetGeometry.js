//
// The Today budget bar as a labelled ruler — pure geometry, so the numbers the
// bar paints can be pinned in a test (jsdom cannot measure a rendered bar).
//
// The ruler maps [left, right] onto the whole track. `left` opens below zero on
// exercise days (−exercise rounded up to 250), so exercise credit sits on the
// LEFT: a hatched "earned" block from −exercise to 0, and the food block starts
// at −exercise with length = food eaten. The food block's right edge is
// therefore NET — the single frontier that crosses the goal band and
// break-even. Marks keep their values; on exercise days they move in pixels.
//
// The band's left edge is `floor − exercise` because the floor is a logging-
// completeness check on FOOD: food ≥ floor ⇔ net ≥ floor − exercise.

export const TICK_STEP = 250;
const HEADROOM = 1.12;
const TICK_CLEARANCE_PX = 12;
const EVEN_CROWD_PX = 40;
const FOOD_LABEL_PX = 70;
const EARNED_LABEL_PX = 36;
const WIDE_PX = 600;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export const fmt = (v) => Math.round(v).toLocaleString('en-US');

/**
 * @param {object} budget - a day from the budget contract (range, zone, food, exercise, net, maintenance, remaining)
 * @param {{ widthPx?: number }} [opts] - the track's rendered width, for label fit and tick density
 */
export function budgetGeometry(budget, { widthPx = 360 } = {}) {
  const food = Math.max(0, num(budget.food));
  const exercise = Math.max(0, num(budget.exercise));
  const net = food - exercise;
  const floor = num(budget.range?.floor);
  const top = num(budget.range?.top);
  const even = num(budget.maintenance);
  const zone = budget.zone;

  const left = exercise > 0 ? -Math.ceil(exercise / TICK_STEP) * TICK_STEP : 0;
  const right = Math.max(even, net, top, floor, 1) * HEADROOM;
  const span = right - left;
  const pxPerKcal = widthPx / span;
  const pct = (v) => ((Math.min(Math.max(v, left), right) - left) / span) * 100;
  const segment = (from, to) => ({ fromPct: pct(Math.min(from, to)), widthPct: Math.abs(pct(to) - pct(from)) });

  const bandFrom = Math.max(left, floor - exercise);
  const collapsed = bandFrom >= top;
  const band = {
    fromPct: pct(collapsed ? top : bandFrom),
    toPct: pct(top),
    collapsed,
    label: collapsed || floor === top ? `Goal ${fmt(top)}` : `Goal ${fmt(floor)}–${fmt(top)}`,
  };

  const evenMark = even > 0 ? { pct: pct(even), value: even, wordless: Math.abs(even - top) * pxPerKcal < EVEN_CROWD_PX } : null;
  const zero = exercise > 0 ? pct(0) : null;

  const named = [bandFrom, top, ...(even > 0 ? [even] : []), ...(exercise > 0 ? [0] : [])];
  const labelEvery = widthPx >= WIDE_PX ? 500 : 1000;
  const ticks = [];
  for (let v = Math.floor(left / TICK_STEP) * TICK_STEP + TICK_STEP; v < right; v += TICK_STEP) {
    if (v === 0) continue; // the zero line is its own mark, or the ruler's start
    if (named.some((m) => Math.abs(m - v) * pxPerKcal < TICK_CLEARANCE_PX)) continue;
    ticks.push({ value: v, pct: pct(v), label: v % labelEvery === 0 ? fmt(v) : null });
  }

  const earned = exercise > 0
    ? { ...segment(-exercise, 0), value: exercise, labelled: exercise * pxPerKcal >= EARNED_LABEL_PX }
    : null;
  const foodSeg = { ...segment(-exercise, net), value: food, labelled: food * pxPerKcal >= FOOD_LABEL_PX };

  const runEnds = {
    incomplete: [net, bandFrom],
    'in-range': [net, top],
    over: [top, net],
    'past-even': [even, net],
  }[zone];
  const run = runEnds ? { ...segment(runEnds[0], runEnds[1]), value: Math.round(num(budget.remaining)) } : null;

  return { left, right, pct, ticks, band, even: evenMark, zero, earned, food: foodSeg, run, zone };
}

export default budgetGeometry;
