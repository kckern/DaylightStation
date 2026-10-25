// Plain-text templates. Every displayed number belongs to the selected facts;
// only the delivery channel escapes the result.
const number = value => Math.round(value);
const basis = facts => facts.goalBasis === 'current' ? ' Based on current configured goals.' : '';

export function renderObservation(observation) {
  if (!observation) return '';
  const { kind, date, facts: f } = observation;
  const prefix = `${date}: `;
  switch (kind) {
    case 'logging_incomplete': {
      if (f.status === 'period') return `${f.from} to ${f.to}: ${f.trustedDays} of ${f.totalDays} days have trustworthy finished logs; intake comparisons are unavailable for the other days.`;
      const status = {
        reconstructed: 'Intake is estimated; calorie-plan and protein assessments are unavailable.',
        unavailable: 'Calorie-budget evidence is unavailable.',
        unlogged: 'No food is logged.',
        incomplete: 'The food log is incomplete; it does not support an intake verdict.',
        in_progress: 'The food log is still in progress.',
      }[f.status];
      return `${prefix}${f.eventFoods?.length ? `Just logged: ${f.eventFoods.join(', ')}. ` : ''}${status}`;
    }
    case 'within_plan':
      return `${prefix}Within your exercise-adjusted calorie plan${!f.finished ? ' so far.' : f.proteinGap > 0 ? `; protein was ${number(f.proteinGap)}g below your ${number(f.proteinGoal)}g target.` : '.'}${basis(f)}`;
    case 'over_plan':
      return `${prefix}${number(f.overPlanKcal)} cal above your exercise-adjusted plan${f.finished ? '' : ' so far'}${f.belowMaintenance ? ', still below estimated maintenance' : ''}.${basis(f)}`;
    case 'energy_surplus':
      return `${prefix}${number(f.surplusKcal)} cal above estimated maintenance${f.finished ? '' : ' so far'}.${basis(f)}`;
    case 'protein_gap':
      return `${prefix}Protein was ${number(f.proteinGap)}g below your ${number(f.proteinGoal)}g target (${number(f.protein)}g logged).${basis(f)}`;
    case 'exercise_budget':
      return `${prefix}${number(f.exercise)} cal of exercise credit is included once in your ${number(f.planFood)} cal food plan.${basis(f)}`;
    case 'period_summary':
      return `${f.from} to ${f.to}: ${f.withinPlan} of ${f.trustedDays} trustworthy finished days were within the exercise-adjusted plan; ${f.overPlan} were over plan and ${f.surplus} were above estimated maintenance. Coverage: ${f.trustedDays} of ${f.totalDays} days.${basis(f)}`;
    default:
      return '';
  }
}
