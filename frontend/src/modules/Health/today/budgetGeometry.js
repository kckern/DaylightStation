//
// The Today budget bar as a labelled ruler — pure geometry, so the numbers the
// bar paints can be pinned in a test (jsdom cannot measure a rendered bar).
//
// The ruler is FOOD eaten, from 0. The food block runs 0 → food; what is left
// is drawn ahead of it as the price tiers from budgetTiers.mjs (free, workout,
// deficit), each starting at the frontier or its own start, whichever is
// later, so a spent tier disappears and a part-spent one shrinks. Two plan
// marks stay put: the goal at the top, and on exercise days the ceiling
// (top + exercise) that "over plan" counts from. Break even sits below.

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
  const { food, exercise, top, ceiling, even, capped } = lines;

  const right = Math.max(even ?? 0, food, ceiling, 1) * HEADROOM;
  const pxPerKcal = widthPx / right;
  const pct = (v) => (Math.min(Math.max(v, 0), right) / right) * 100;
  const segment = (from, to) => ({ fromPct: pct(Math.min(from, to)), widthPct: Math.abs(pct(to) - pct(from)) });

  const named = [top, ...(exercise > 0 ? [ceiling] : []), ...(even != null ? [even] : [])];
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

  // The workout's room, not the raw exercise: break even can cap the ceiling.
  const goalLabel = capped ? `Goal · break even ${fmt(top)}`
    : ceiling > top ? `Goal ${fmt(top)} + ${fmt(ceiling - top)}` : `Goal ${fmt(top)}`;

  return {
    right, pct, ticks, tiers, zone: budget.zone,
    goal: { pct: pct(top), value: top, label: goalLabel },
    ceiling: exercise > 0 && ceiling > top ? { pct: pct(ceiling), value: ceiling } : null,
    even: even != null ? { pct: pct(even), value: even } : null,
    food: foodSeg,
  };
}

export default budgetGeometry;
