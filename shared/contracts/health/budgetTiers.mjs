// The budget as a price list, on the FOOD scale. What is left today falls into
// tiers, each named by what eating into it costs:
//
//   free     0 → top                 costs nothing: the plan holds
//   workout  top → top + exercise    costs the workout's benefit
//   deficit  ceiling → break even    costs the day's progress
//   (beyond break even the day is a gain)
//
// Every line is capped at break even, and zero-width tiers are dropped, so
// `tiers[0]` is not necessarily 'free' (with no range there is no free tier).
//
// Derived from the same fields zoneFor reads, and agreeing with it
// (budgetTiers.test.mjs sweeps both). The zone contract is unchanged: the coach,
// nutribot and the week strip keep reading zones; the Today card reads tiers.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * @returns {{ food: number, exercise: number, floor: number, top: number, ceiling: number,
 *   even: number|null, capped: boolean }}
 */
export function budgetLines({ food, exercise, maintenance, range }) {
  const ex = Math.max(0, num(exercise));
  const even = num(maintenance) > 0 ? num(maintenance) + ex : null;
  // A floor above maintenance puts the plan past break even; zoneFor tests
  // break even first, so no tier may run past it.
  const cap = (v) => (even == null ? v : Math.min(v, even));
  const top = num(range?.top);
  // Negative food reads as nothing eaten.
  return {
    food: Math.max(0, num(food)), exercise: ex, floor: num(range?.floor),
    top: cap(top), ceiling: cap(top + ex), even, capped: cap(top) < top,
  };
}

/**
 * @returns {{ lines: ReturnType<typeof budgetLines>,
 *   tiers: Array<{ key: 'free'|'workout'|'deficit', from: number, to: number, used: number, left: number }>,
 *   spend: 'free'|'workout'|'over'|'gain', over: number, gain: number }}
 */
export function priceLadder(budget) {
  const L = budgetLines(budget);
  const bounds = [
    { key: 'free', from: 0, to: L.top },
    ...(L.exercise > 0 ? [{ key: 'workout', from: L.top, to: L.ceiling }] : []),
    ...(L.even != null ? [{ key: 'deficit', from: L.ceiling, to: L.even }] : []),
  ];
  const tiers = bounds.filter(t => t.to > t.from).map(t => ({
    ...t,
    used: Math.round(Math.min(Math.max(L.food - t.from, 0), t.to - t.from)),
    left: Math.round(Math.max(0, t.to - Math.max(t.from, L.food))),
  }));
  const spend = L.even != null && L.food > L.even ? 'gain'
    : L.food > L.ceiling ? 'over'
      : L.food > L.top ? 'workout' : 'free';
  return {
    lines: L, tiers, spend,
    over: Math.round(Math.max(0, L.food - L.ceiling)),
    gain: L.even == null ? 0 : Math.round(Math.max(0, L.food - L.even)),
  };
}

/**
 * What `delta` more kcal would cost, split across the tiers it lands in, in
 * order. Past the last tier it is a `gain` (or `over`, when break even is
 * unknown). A zero or negative delta costs nothing.
 */
export function priceOf(budget, delta) {
  const { lines: L, tiers } = priceLadder(budget);
  const start = L.food;
  const end = start + num(delta);
  if (end <= start) return [];
  const spans = [
    ...tiers.map(({ key, from, to }) => ({ key, from, to })),
    { key: L.even == null ? 'over' : 'gain', from: L.even ?? L.ceiling, to: Infinity },
  ];
  // Round the boundaries, not each share, so the parts sum exactly to the
  // rounded change (Math.round(Infinity) stays Infinity; min clips it).
  return spans
    .map(({ key, from, to }) => ({ key, kcal: Math.max(0, Math.round(Math.min(end, to)) - Math.round(Math.max(start, from))) }))
    .filter(p => p.kcal > 0);
}
