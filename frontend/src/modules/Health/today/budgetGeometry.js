// One food-calorie scale. Position says how much was eaten; the colour of each
// consumed interval says which budget tier it spent. Logging completeness is a
// separate marker, never the start of a painted goal band.
import { priceLadder } from '@shared-contracts/health/budgetTiers.mjs';

const HEADROOM = 1.12;
const DOMAIN_STEP = 500;
const GROUP_PX = 6;

export const fmt = (v) => Math.round(v).toLocaleString('en-US');

export function budgetGeometry(budget, {
  widthPx = 360, finished = false, baselineFood = null, rightOverride = null,
} = {}) {
  const { lines: L, tiers } = priceLadder(budget);
  const { food, floor, top: base, ceiling: plan, even, exercise } = L;
  const configuredBase = Number(budget.range?.top) || 0;
  const baseline = baselineFood == null ? null : Number(baselineFood);
  const maximum = Math.max(1, floor, base, plan, even ?? 0, food, baseline ?? 0);
  const right = rightOverride > 0 ? rightOverride : Math.ceil(maximum * HEADROOM / DOMAIN_STEP) * DOMAIN_STEP;
  const pct = (value) => 100 * Math.min(Math.max(value, 0), right) / right;
  const interval = (key, from, to) => ({
    key, from, to, fromPct: pct(from), widthPct: pct(to) - pct(from),
  });
  const consumed = [
    interval('base', 0, Math.min(food, base)),
    interval('workout', base, Math.min(food, plan)),
    interval('over', plan, Math.min(food, even ?? food)),
    ...(even == null ? [] : [interval('surplus', even, food)]),
  ].filter(part => part.to > part.from);
  const available = finished ? [] : [
    interval('base', food, base),
    interval('workout', Math.max(food, base), plan),
  ].filter(part => part.to > part.from);
  const goalRange = floor > 0 && floor < plan ? {
    from: floor,
    to: plan,
    ...segmentRange(floor, plan, pct),
    bonus: plan > base ? workoutRange(base, plan, food, pct, finished) : null,
  } : null;

  const posts = [
    ...(floor > 0 ? [{ key: 'floor', value: floor, label: 'Log floor' }] : []),
    ...(plan > base ? [{ key: 'base', value: base, label: 'Base target' }] : []),
    { key: 'plan', value: plan, label: 'Plan end' },
    ...(even == null ? [] : [{ key: 'even', value: even, label: 'Break even' }]),
  ].map(post => ({ ...post, pct: pct(post.value) }));
  const postGroups = [];
  for (const post of [...posts].sort((a, b) => a.value - b.value)) {
    const last = postGroups.at(-1);
    if (last && Math.abs(post.pct - last.pct) * widthPx / 100 < GROUP_PX) {
      last.posts.push(post);
    } else {
      postGroups.push({ pct: post.pct, posts: [post] });
    }
  }

  const usableBoost = Math.max(0, plan - base);
  const baseCapped = even != null && base < configuredBase;
  const boostCapped = exercise > 0 && usableBoost < exercise;
  const capNote = baseCapped
    ? `Configured base target ${fmt(configuredBase)}; usable plan capped at break even`
    : boostCapped ? `${fmt(usableBoost)} of ${fmt(exercise)} workout kcal available before break even` : null;

  return {
    right, pct, consumed, available, goalRange, posts, postGroups,
    boundaries: { floor, configuredBase, base, plan, even },
    cursor: { value: food, pct: pct(food), overflow: food > right },
    baselineCursor: baseline != null && baseline !== food
      ? { value: baseline, pct: pct(baseline), overflow: baseline > right } : null,
    floorIssue: floor > plan,
    capNote,
    tiers,
  };
}

function segmentRange(from, to, pct) {
  return { fromPct: pct(from), toPct: pct(to), widthPct: pct(to) - pct(from) };
}

function workoutRange(from, to, food, pct, finished) {
  const spentTo = Math.min(Math.max(food, from), to);
  return {
    from,
    to,
    spentTo,
    ...segmentRange(from, to, pct),
    spentWidthPct: pct(spentTo) - pct(from),
    availableFromPct: pct(spentTo),
    availableWidthPct: finished ? 0 : pct(to) - pct(spentTo),
  };
}

export default budgetGeometry;
