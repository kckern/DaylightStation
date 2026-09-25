//
// The Today budget bar as a labelled ruler — pure geometry, so the numbers the
// bar paints can be pinned in a test (jsdom cannot measure a rendered bar).
//
// The ruler is FOOD eaten, from 0. Every block and label sits at the value it
// names: the food block runs 0 → food, the goal band starts at the floor (which
// already measures food). The server compares the top and break-even against
// NET; on a food scale that is the same comparison with exercise added to both
// sides, so exercise RAISES the ceiling (top + exercise) and break-even
// (maintenance + exercise). A hatched block from top to the ceiling shows the
// credit exercise earned. The server's zones and `remaining` carry over
// unchanged: the dotted run's length in kcal is the headline number.

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
 * @param {object} budget - a day from the budget contract (range, zone, food, exercise, maintenance, remaining)
 * @param {{ widthPx?: number }} [opts] - the track's rendered width, for label fit and tick density
 */
export function budgetGeometry(budget, { widthPx = 360 } = {}) {
  const food = Math.max(0, num(budget.food));
  const exercise = Math.max(0, num(budget.exercise));
  const floor = num(budget.range?.floor);
  const top = num(budget.range?.top);
  const maintenance = num(budget.maintenance);
  const zone = budget.zone;

  const ceiling = top + exercise;
  const even = maintenance > 0 ? maintenance + exercise : 0;

  const right = Math.max(even, food, ceiling, floor, 1) * HEADROOM;
  const pxPerKcal = widthPx / right;
  const pct = (v) => (Math.min(Math.max(v, 0), right) / right) * 100;
  const segment = (from, to) => ({ fromPct: pct(Math.min(from, to)), widthPct: Math.abs(pct(to) - pct(from)) });

  // The server guarantees top ≥ floor; floor = top means one goal number.
  const single = floor >= top;
  const band = {
    fromPct: pct(single ? top : floor),
    toPct: pct(ceiling),
    label: single ? `Goal ${fmt(top)}` : `Goal ${fmt(floor)}–${fmt(top)}`,
  };

  const evenMark = even > 0 ? { pct: pct(even), value: even, wordless: Math.abs(even - ceiling) * pxPerKcal < EVEN_CROWD_PX } : null;

  const named = [...(single ? [] : [floor]), top, ...(exercise > 0 ? [ceiling] : []), ...(even > 0 ? [even] : [])];
  const labelEvery = widthPx >= WIDE_PX ? 500 : 1000;
  const ticks = [];
  for (let v = TICK_STEP; v < right; v += TICK_STEP) {
    if (named.some((m) => Math.abs(m - v) * pxPerKcal < TICK_CLEARANCE_PX)) continue;
    ticks.push({ value: v, pct: pct(v), label: v % labelEvery === 0 ? fmt(v) : null });
  }

  // "N eaten" ends at the frontier; a block too short for it carries the label
  // just past the frontier instead of dropping it.
  const foodPx = food * pxPerKcal;
  const outside = foodPx < FOOD_LABEL_PX;
  const foodSeg = { ...segment(0, food), value: food, labelled: food > 0, outside };
  const foodLabel = outside ? [foodPx, foodPx + FOOD_LABEL_PX] : [foodPx - FOOD_LABEL_PX, foodPx];

  // "+N" is centred on the hatch and drops where the eaten label (drawn above
  // it) would cover it.
  const hatchMidPx = ((top + ceiling) / 2) * pxPerKcal;
  const hatchLabel = [hatchMidPx - EARNED_LABEL_PX / 2, hatchMidPx + EARNED_LABEL_PX / 2];
  const underFoodLabel = foodSeg.labelled && hatchLabel[0] < foodLabel[1] && foodLabel[0] < hatchLabel[1];
  const earned = exercise > 0
    ? { ...segment(top, ceiling), value: exercise, labelled: exercise * pxPerKcal >= EARNED_LABEL_PX && !underFoodLabel }
    : null;

  const runEnds = {
    incomplete: [food, ceiling],
    'in-range': [food, ceiling],
    over: [ceiling, food],
    'past-even': [even, food],
  }[zone];
  const run = runEnds ? { ...segment(runEnds[0], runEnds[1]), value: Math.round(num(budget.remaining)) } : null;

  return { right, pct, ticks, band, ceiling, even: evenMark, earned, food: foodSeg, run, zone };
}

export default budgetGeometry;
