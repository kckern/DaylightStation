//
// The Today budget card, told as the job the person has right now
// (docs/_wip/plans/2026-09-25-health-budget-card-jobs.md):
//
//   trust    live, under the floor, not closed — the free number, dimmed
//   afford   live, within the plan — what is free, then what the rest costs
//   contain  live, past the plan — how far to break even
//   judge    finished (past date, or closed done/fasted) — the verdict
//
// One vocabulary everywhere: free, workout, deficit, to break even, over plan.
// Pure: the card, its tests and the drag preview all read the same sentence.
import { priceLadder, priceOf } from '@shared-contracts/health/budgetTiers.mjs';

const n = (v) => Math.round(Number(v || 0)).toLocaleString('en-US');
const join = (parts) => parts.filter(Boolean).join(' · ') || null;
const PRICE_WORDS = { free: 'free', workout: 'workout', deficit: 'deficit', over: 'over plan', gain: 'past break even' };

/** A past date, or a day declared done or fasted. A skipped meal does not finish a day. */
export function isFinishedDay({ date, today, declared }) {
  return Boolean(date && today && date < today) || declared === 'done' || declared === 'fasting';
}

// While a portion is being dragged, the sub-line prices the change.
function priceLine(budget, baseline) {
  const delta = Number(budget.food) - Number(baseline.food);
  if (!Number.isFinite(delta) || Math.round(delta) === 0) return null;
  if (delta < 0) return `gives back ${n(-delta)}`;
  return `this costs ${priceOf(baseline, delta).map(p => `${n(p.kcal)} ${PRICE_WORDS[p.key]}`).join(' + ')}`;
}

function judge({ lines: L, spend, over, gain, tiers }, budget) {
  const ended = L.even == null ? null : `ended ${n(L.even - L.food)} under break even`;
  if (budget.zone === 'incomplete') {
    return { value: null, text: 'Incomplete log', sub: `${n(L.food)} logged, under the ${n(L.floor)} floor · no verdict` };
  }
  if (spend === 'gain') return { value: null, text: `Surplus of ${n(gain)}`, sub: over > gain ? `missed plan by ${n(over)}` : null };
  if (spend === 'over') return { value: null, text: `Missed plan by ${n(over)}`, sub: ended };
  if (budget.declared === 'fasting') return { value: null, text: 'Fasted', sub: ended };
  // Capped at break even, the workout tier can be narrower than the burn, or absent.
  const workout = tiers.find(t => t.key === 'workout');
  const room = workout ? workout.to - workout.from : 0;
  const spent = !workout ? null
    : spend === 'workout' ? `ate back ${n(workout.used)} of ${n(room)} workout`
      : `workout banked (${n(room)})`;
  return { value: null, text: 'On plan', sub: join([spent, ended]) };
}

function live({ lines: L, spend, over, gain, tiers }) {
  const tier = (key) => tiers.find(t => t.key === key);
  const deficit = tier('deficit');
  const workout = tier('workout');
  const toEven = L.even == null ? null : `${n(L.even - L.food)} to break even`;
  const deficitPrice = deficit ? `${n(deficit.left)} deficit` : null;
  if (spend === 'gain') return { value: gain, text: 'past break even', sub: over > gain ? `${n(over)} over plan` : null };
  if (spend === 'over') {
    return deficit
      ? { value: deficit.left, text: 'to break even', sub: `${n(over)} over plan` }
      : { value: over, text: 'over plan', sub: null };
  }
  if (spend === 'workout') {
    return { value: workout.left, text: 'of workout left', sub: join([`used ${n(workout.used)} of ${n(workout.to - workout.from)}`, deficitPrice, toEven]) };
  }
  const rest = join([workout && `${n(workout.left)} workout`, deficitPrice, toEven]);
  return { value: tier('free').left, text: 'free', sub: rest && `then ${rest}` };
}

/**
 * @param {object} budget - a day from the budget contract (range + zone required)
 * @param {{ date?: string, today?: string, baseline?: object|null }} [ctx]
 * @returns {{ job: 'trust'|'afford'|'contain'|'judge', value: number|null, text: string, sub: string|null,
 *   finished: boolean, tentative: boolean, ladder: object }}
 */
export function budgetStory(budget, { date = null, today = null, baseline = null } = {}) {
  const ladder = priceLadder(budget);
  const finished = isFinishedDay({ date, today, declared: budget.declared });
  // An unverified log still leads with the free number (the morning's Afford
  // job); the dimmed bar and the sub-line say it rests on a complete log.
  const tentative = !finished && budget.zone === 'incomplete';
  let job;
  let told;
  if (finished) { job = 'judge'; told = judge(ladder, budget); }
  else if (tentative) {
    const { lines: L, tiers } = ladder;
    job = 'trust';
    told = { value: tiers.find(t => t.key === 'free')?.left ?? 0, text: 'free',
      sub: `${n(Math.max(0, L.floor - L.food))} under the ${n(L.floor)} floor · prices assume the log is complete` };
  } else {
    job = ladder.spend === 'over' || ladder.spend === 'gain' ? 'contain' : 'afford';
    told = live(ladder);
  }
  const priced = !finished && baseline ? priceLine(budget, baseline) : null;
  return { job, ...told, sub: priced ?? told.sub, finished, tentative, ladder };
}

export default budgetStory;
