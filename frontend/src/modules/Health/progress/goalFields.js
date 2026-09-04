// Pure shape rules for the macro-goal / watch-micro half of the goals form
// (Task 6.1). Kept out of ProgressView.jsx so the rules that matter — an
// absent key stays absent, a cleared limit removes the watch — are testable
// without mounting a chart.
//
// The server (BudgetService.setGoals) is the authority and rejects anything
// off-shape with GOALS_INVALID; these helpers exist so the form never builds
// a payload the server has to refuse.

/** Macro targets, in grams. `null` is a CLEARED target, never a zero target. */
export const MACRO_GOAL_FIELDS = [
  { key: 'proteinG', label: 'Protein goal', macro: 'protein' },
  { key: 'carbsG', label: 'Carbs goal', macro: 'carbs' },
  { key: 'fatG', label: 'Fat goal', macro: 'fat' },
];

/** The four micros a person can watch, with the direction each usually runs. */
export const WATCH_MICRO_FIELDS = [
  { key: 'sodium', label: 'Sodium', unit: 'mg', defaultDirection: 'ceiling' },
  { key: 'sugar', label: 'Sugar', unit: 'g', defaultDirection: 'ceiling' },
  { key: 'cholesterol', label: 'Cholesterol', unit: 'mg', defaultDirection: 'ceiling' },
  { key: 'fiber', label: 'Fiber', unit: 'g', defaultDirection: 'floor' },
];

const numberOrNull = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Drop a key from an object without mutating it. */
const without = (obj, key) => {
  const { [key]: _dropped, ...rest } = obj;
  return rest;
};

/**
 * Set one macro target. Clearing every target removes `macroGoals` entirely
 * rather than leaving an object of nulls behind — a goals file that never had
 * the key must be able to get back to not having it.
 */
export function setMacroGoal(goals, key, value) {
  const next = { ...(goals.macroGoals || {}), [key]: numberOrNull(value) };
  const anySet = MACRO_GOAL_FIELDS.some((f) => next[f.key] != null);
  return anySet ? { ...goals, macroGoals: next } : without(goals, 'macroGoals');
}

/** The watch entry for a micro, or null when it isn't being watched. */
export function watchFor(goals, key) {
  const list = Array.isArray(goals?.watchMicros) ? goals.watchMicros : [];
  return list.find((w) => w?.key === key) || null;
}

/**
 * Add / update / remove one watch micro.
 * A limit that is cleared (or not a positive number) REMOVES the watch —
 * "watching with no limit" is not a state, and the server refuses it.
 */
export function setWatchMicro(goals, key, patch) {
  const field = WATCH_MICRO_FIELDS.find((f) => f.key === key);
  if (!field) return goals;
  const list = Array.isArray(goals.watchMicros) ? [...goals.watchMicros] : [];
  const index = list.findIndex((w) => w?.key === key);
  const current = index >= 0 ? list[index] : { key, limit: null, direction: field.defaultDirection };
  const next = { ...current, ...patch };
  const limit = numberOrNull(next.limit);

  if (limit == null || limit <= 0) {
    if (index >= 0) list.splice(index, 1);
  } else {
    const entry = { key, limit, direction: next.direction || field.defaultDirection };
    if (index >= 0) list[index] = entry; else list.push(entry);
  }
  return list.length ? { ...goals, watchMicros: list } : without(goals, 'watchMicros');
}
