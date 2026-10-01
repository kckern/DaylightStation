//
// The Today budget bar as a labelled ruler — pure geometry, so the numbers the
// bar paints can be pinned in a test (jsdom cannot measure a rendered bar).
//
// The ruler is FOOD eaten, from 0. The food block runs 0 → food; what is left
// is drawn ahead of it as the price tiers from budgetTiers.mjs (free, workout,
// deficit), each starting at the frontier or its own start, whichever is
// later, so a spent tier disappears and a part-spent one shrinks. The goal is
// a range, floor → ceiling: the plan's top grows by the day's exercise (the
// workout's room), and "over plan" counts from that upper end. On exercise days
// a dashed base mark keeps the plan's top before the workout, where the free
// tier turns into the workout tier. Break even sits below.

import { priceLadder } from '@shared-contracts/health/budgetTiers.mjs';

export const TICK_STEP = 250;
const HEADROOM = 1.12;
const TICK_CLEARANCE_PX = 12;
const FOOD_LABEL_PX = 70;
const TIER_WORDS_PX = 64;
const TIER_NUMBER_PX = 30;
const WIDE_PX = 600;

const LIVE_WORDS = { free: 'free', workout: 'workout', deficit: 'deficit' };
const FINISHED_WORDS = { free: 'unused', workout: 'banked', deficit: 'deficit' };

export const fmt = (v) => Math.round(v).toLocaleString('en-US');

/**
 * @param {object} budget - a day from the budget contract (range, zone, food, exercise, maintenance)
 * @param {{ widthPx?: number, finished?: boolean }} [opts] - track width for label fit; finished names tiers as outcomes
 */
export function budgetGeometry(budget, { widthPx = 360, finished = false } = {}) {
  const { lines, tiers: ladder } = priceLadder(budget);
  const { food, exercise, floor, top, ceiling, even, capped } = lines;

  const right = Math.max(even ?? 0, food, ceiling, 1) * HEADROOM;
  const pxPerKcal = widthPx / right;
  const pct = (v) => (Math.min(Math.max(v, 0), right) / right) * 100;
  const segment = (from, to) => ({ fromPct: pct(Math.min(from, to)), widthPct: Math.abs(pct(to) - pct(from)) });

  // The goal is a range: floor (logging completeness) to the ceiling (the plan
  // plus the workout's room, capped at break even).
  const upper = ceiling;
  const ranged = !capped && floor > 0 && floor < upper;
  const named = [...(ranged ? [floor] : []), top, ...(exercise > 0 ? [ceiling] : []), ...(even != null ? [even] : [])];
  const labelEvery = widthPx >= WIDE_PX ? 500 : 1000;
  const ticks = [];
  for (let v = TICK_STEP; v < right; v += TICK_STEP) {
    if (named.some((m) => Math.abs(m - v) * pxPerKcal < TICK_CLEARANCE_PX)) continue;
    ticks.push({ value: v, pct: pct(v), label: v % labelEvery === 0 ? fmt(v) : null });
  }

  // "N eaten" ends at the frontier; a block too short for it carries the label
  // just past the frontier instead of dropping it.
  const foodPx = food * pxPerKcal;
  // The label never sits on the exercise bonus hatch: past the goal it moves
  // just past the frontier; ending inside the bonus, it ends where the hatch
  // starts instead (or past the frontier when there is no room before it).
  const bonusFrom = Math.max(floor, top);
  const hasBonus = !capped && floor > 0 && floor < ceiling && ceiling > bonusFrom;
  const onBonus = hasBonus && food > bonusFrom && foodPx - FOOD_LABEL_PX < ceiling * pxPerKcal;
  const beforeBonus = onBonus && food <= ceiling && bonusFrom * pxPerKcal >= FOOD_LABEL_PX;
  const outside = foodPx < FOOD_LABEL_PX || (onBonus && !beforeBonus);
  const labelEndPx = beforeBonus ? bonusFrom * pxPerKcal : foodPx;
  // The food block splits by where it ends against the goal (2026-10-01):
  //   within the plan        one block in the zone colour
  //   into the workout bonus 0 → top in the zone colour, top → food caution (yellow)
  //   past the goal          0 → ceiling caution, ceiling → food overshoot (orange)
  //   past break even        one block, red
  // and the eaten part of the bonus hatch goes orange (maroon in surplus).
  const pastEven = even != null && food > even;
  const intoBonus = exercise > 0 && ceiling > top && food > top;
  const parts = pastEven ? [{ from: 0, to: food, tone: 'past-even' }]
    : food > ceiling && ceiling > 0 ? [{ from: 0, to: ceiling, tone: 'caution' }, { from: ceiling, to: food, tone: 'overshoot' }]
      : intoBonus ? [{ from: 0, to: top, tone: budget.zone }, { from: top, to: food, tone: 'caution' }]
        : [{ from: 0, to: food, tone: budget.zone }];
  const bonusSpent = pastEven ? 'surplus' : food > top ? 'spent' : null;
  const foodSeg = { ...segment(0, food), value: food, labelled: food > 0, outside,
    parts: parts.filter(p => p.to > p.from).map(p => ({ ...segment(p.from, p.to), tone: p.tone })),
    tone: parts[parts.length - 1].tone };
  const foodLabel = outside ? [foodPx, foodPx + FOOD_LABEL_PX] : [labelEndPx - FOOD_LABEL_PX, labelEndPx];
  foodSeg.labelEndPct = beforeBonus ? pct(bonusFrom) : foodSeg.fromPct + foodSeg.widthPct;
  // Its pill takes the colour of the part it sits on.
  foodSeg.labelTone = beforeBonus ? parts[0].tone : foodSeg.tone;

  // A tier shows "321 free" where it fits, "321" where only the number fits,
  // and nothing below that or where the eaten label (drawn above) covers it.
  const words = finished ? FINISHED_WORDS : LIVE_WORDS;
  const tiers = ladder.filter(t => t.left > 0).map((t) => {
    const from = Math.max(t.from, food);
    const widthOfTier = (t.to - from) * pxPerKcal;
    const midPx = ((from + t.to) / 2) * pxPerKcal;
    const label = `${fmt(t.left)} ${words[t.key]}`;
    const fits = (px) => widthOfTier >= px
      && !(foodSeg.labelled && midPx - px / 2 < foodLabel[1] && foodLabel[0] < midPx + px / 2);
    const shown = fits(TIER_WORDS_PX) ? label : fits(TIER_NUMBER_PX) ? fmt(t.left) : null;
    return { ...segment(from, t.to), key: t.key, left: t.left, label, shown };
  });

  // The workout's bonus hatch rides above the food, so it stays visible once
  // eaten into. Once the food has covered all of it, the workout tier (and its
  // price label) is gone, so the bonus carries the workout's room as a number.
  const bonusMidPx = ((bonusFrom + upper) / 2) * pxPerKcal;
  const bonusFits = (upper - bonusFrom) * pxPerKcal >= TIER_NUMBER_PX
    && !(foodSeg.labelled && bonusMidPx - TIER_NUMBER_PX / 2 < foodLabel[1] && foodLabel[0] < bonusMidPx + TIER_NUMBER_PX / 2);
  const bonusEaten = Math.min(Math.max(food, bonusFrom), upper);
  const bonus = { ...segment(bonusFrom, upper), value: Math.round(upper - top),
    shown: food >= upper && bonusFits ? fmt(upper - top) : null,
    parts: [
      ...(bonusSpent && bonusEaten > bonusFrom ? [{ ...segment(bonusFrom, bonusEaten), tone: bonusSpent }] : []),
      ...(upper > bonusEaten ? [{ ...segment(bonusEaten, upper), tone: 'free' }] : []),
    ] };

  const goalLabel = capped ? `Goal · break even ${fmt(top)}`
    : ranged ? `Goal ${fmt(floor)}–${fmt(upper)}` : `Goal ${fmt(upper)}`;

  return {
    right, pct, ticks, tiers, zone: budget.zone,
    goal: { pct: pct(upper), value: upper, label: goalLabel },
    // The band is solid floor → top; the workout's bonus, top → ceiling, is hatched.
    range: ranged ? { ...segment(floor, upper), floor, floorPct: pct(floor),
      solid: segment(floor, Math.max(floor, top)), bonus: upper > Math.max(floor, top) ? bonus : null } : null,
    base: exercise > 0 && ceiling > top ? { pct: pct(top), value: top } : null,
    even: even != null ? { pct: pct(even), value: even } : null,
    food: foodSeg,
  };
}

export default budgetGeometry;
