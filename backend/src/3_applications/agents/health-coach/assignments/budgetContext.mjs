// Shared by the health-coach assignments that judge a day.
//
// A day's totals are trustworthy only when the budget says `complete`: it
// reached the floor, or the user declared it done/fasted. The time of day
// never makes a day complete (an under-logged evening is missing data, not a
// deficit). The floor and top come from the budget's range — the numbers the
// Today bar shows — not from the older nutrition goals in the coach's config.

export const DEFAULT_TZ = 'America/Los_Angeles';

/** The user's calendar date, `offsetDays` from now, as YYYY-MM-DD. */
export function localDate(offsetDays = 0, tz = DEFAULT_TZ, now = Date.now()) {
  return new Date(now + offsetDays * 86400000).toLocaleDateString('en-CA', { timeZone: tz });
}

/** The user's local hour (0–23), for pacing and tone only — never completeness. */
export function localHour(tz = DEFAULT_TZ, now = new Date()) {
  return Number.parseInt(now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }), 10) % 24;
}

/**
 * The goals document as the model should see it: the nutrition calorie
 * min/max replaced by the budget range, so the prompt never shows two
 * different "goals".
 */
export function goalsWithRange(goals, day) {
  const range = day?.range;
  if (!range) return goals || {};
  const doc = goals?.goals ? goals : { goals: goals || {} };
  return {
    ...doc,
    goals: {
      ...doc.goals,
      nutrition: { ...(doc.goals?.nutrition || {}), calories_min: range.floor, calories_max: range.top },
    },
  };
}

/** Floor (completeness threshold) and top (the plan), budget first. */
export function rangeOf(day, goals) {
  const nutrition = goals?.goals?.nutrition || {};
  return {
    floor: day?.range?.floor ?? nutrition.calories_min ?? 1200,
    top: day?.range?.top ?? nutrition.calories_max ?? null,
  };
}
