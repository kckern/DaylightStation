// One-off planner for the budget-range migration (Phase 1 of
// docs/_wip/plans/2026-09-24-health-budget-range-design.md). Reads the legacy
// floor/target settings, reports every value and disagreement, and proposes
// only one change: filling an UNSET budgetFloor. It never invents a targetDate
// — that is a personal decision, surfaced as a conflict instead.
const positive = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

/**
 * @returns {{ set: { budgetFloor?: number }, report: Array<{key: string, source: string, value: number}>, conflicts: string[] }}
 */
export function planBudgetSettingsMigration({ healthGoals = {}, profile = {}, coachGoals = {}, coachingConfig = {}, today }) {
  const floors = [
    ['health.budgetFloor', positive(healthGoals.budgetFloor)],
    ['profile.apps.nutribot.goals.calories_min', positive(profile?.apps?.nutribot?.goals?.calories_min)],
    ['coach.nutrition.calories_min', positive(coachGoals?.nutrition?.calories_min)],
    ['coaching.logging_completeness.min_calories', positive(coachingConfig?.logging_completeness?.min_calories)],
  ].filter(([, v]) => v != null);
  const tops = [
    ['profile.apps.nutribot.goals.calories_max', positive(profile?.apps?.nutribot?.goals?.calories_max)],
    ['coach.nutrition.calories_max', positive(coachGoals?.nutrition?.calories_max)],
  ].filter(([, v]) => v != null);

  const report = [
    ...floors.map(([source, value]) => ({ key: 'floor', source, value })),
    ...tops.map(([source, value]) => ({ key: 'legacy top (replaced by the computed range top)', source, value })),
  ];

  const conflicts = [];
  if (new Set(floors.map(([, v]) => v)).size > 1) {
    conflicts.push(`floor: sources disagree (${floors.map(([s, v]) => `${s}=${v}`).join(', ')})`);
  }
  const healthTarget = positive(healthGoals.targetWeightLbs);
  const coachTarget = positive(coachGoals?.weight?.target_lbs);
  if (healthTarget && coachTarget && healthTarget !== coachTarget) {
    conflicts.push(`target weight: health goals ${healthTarget} vs coach ${coachTarget}`);
  }
  const coachDate = coachGoals?.weight?.target_date;
  if (coachDate && today && String(coachDate) < today) {
    conflicts.push(`coach target_date ${coachDate} has passed; set health goals targetDate deliberately`);
  }
  if (!healthGoals.targetDate) {
    conflicts.push('health goals has no targetDate: the deficit stays on weeklyRateLbs until one is set');
  }

  const set = {};
  if (positive(healthGoals.budgetFloor) == null && floors.length) set.budgetFloor = floors[0][1];
  return { set, report, conflicts };
}
