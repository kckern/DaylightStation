// The one rule for where a day stands against its goal range. Shared by the
// server (BudgetService) and the client (drag preview, bar headline, strip
// labels) so a live gesture recolours exactly as the server would.
//
//   floor — a LOGGING-COMPLETENESS check, compared against FOOD eaten.
//   top   — the plan (break-even − the day's deficit), compared against NET.
//   even  — break-even (maintenance), compared against NET.
// A day is complete when food ≥ floor, it was declared done/fasted, or any
// meal was declared skipped (a meal fast confirms the log is what was eaten);
// never because of the time of day.

export const ZONES = Object.freeze(['incomplete', 'declared', 'in-range', 'over', 'past-even']);

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function zoneFor({ food, exercise = 0, maintenance, range, declared = null, fastedMeals = [] }) {
  const eaten = num(food);
  const net = eaten - Math.max(0, num(exercise));
  const floor = num(range?.floor);
  const top = num(range?.top);
  const even = num(maintenance);
  const isDeclared = declared === 'done' || declared === 'fasting' || (Array.isArray(fastedMeals) && fastedMeals.length > 0);
  const complete = eaten >= floor || isDeclared;
  const out = (zone, remaining) => ({ zone, remaining: Math.round(remaining), complete, net: Math.round(net) });
  if (even > 0 && net > even) return out('past-even', net - even);
  if (net > top) return out('over', net - top);
  if (eaten >= floor) return out('in-range', top - net);
  if (isDeclared) return out('declared', top - net);
  // Still under the floor: the number is still what is LEFT to the ceiling;
  // the zone (and its colour) is what says the log is not trustworthy yet.
  return out('incomplete', top - net);
}

/** The compatibility `status` alias: over the plan or past break-even. */
export const statusForZone = (zone) => (zone === 'over' || zone === 'past-even' ? 'over' : 'under');

const HEADLINE = { incomplete: 'left', declared: 'left', 'in-range': 'left', over: 'over', 'past-even': 'past break even' };

/** The headline's number and the words that say which segment it measures. */
// Always a number to the ceiling (or past it): a closed or skipped-meal day
// says so on the day-close pill, not in the headline.
export function headlineFor({ zone, remaining }) {
  return { value: Math.round(num(remaining)), text: HEADLINE[zone] || 'left' };
}
