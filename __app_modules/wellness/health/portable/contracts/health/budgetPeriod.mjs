// No fetching, date inference or protein averaging: callers provide one
// assessment for every requested date, including unavailable dates.
const average = (values) => {
  if (!values.length || values.some(value => typeof value !== 'number' || !Number.isFinite(value))) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};
const delta = (food, boundary) => food == null || boundary == null ? null : food - boundary;

/** Energy averages share one trusted finished set; verdict counts expose known coverage. */
export function summarizeBudgetPeriod(assessments) {
  const available = assessments.filter(day => day.availability === 'available');
  const eligible = available.filter(day => day.trustworthy && day.finished);
  const bases = new Set(available.map(day => day.goalBasis ?? null));
  return {
    coverage: {
      total: assessments.length, available: available.length, trustedFinished: eligible.length,
      proteinKnown: eligible.filter(day => day.proteinKnown).length,
      planKnown: eligible.filter(day => day.planState === 'within' || day.planState === 'over').length,
      maintenanceKnown: eligible.filter(day => ['below-maintenance', 'at-maintenance', 'surplus'].includes(day.energyState)).length,
    },
    averages: {
      food: average(eligible.map(day => day.food)),
      exercise: average(eligible.map(day => day.exercise)),
      net: average(eligible.map(day => day.net)),
      planDelta: average(eligible.map(day => delta(day.food, day.planFood))),
      maintenanceDelta: average(eligible.map(day => delta(day.food, day.breakEvenFood))),
    },
    counts: {
      withinPlan: eligible.filter(day => day.planState === 'within').length,
      overPlan: eligible.filter(day => day.planState === 'over').length,
      surplus: eligible.filter(day => day.energyState === 'surplus').length,
    },
    goalBasis: bases.size === 1 ? [...bases][0] : null,
  };
}
