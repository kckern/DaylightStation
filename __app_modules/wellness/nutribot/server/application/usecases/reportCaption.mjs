// Food-scale range and exercise credit share the Health assessment contract.
import { assessBudgetDay } from '../../../../health/portable/contracts/health/budgetAssessment.mjs';

export function buildReportCaption({ totals = {}, budget = null }) {
  const a = assessBudgetDay(budget);
  if (a.food == null || a.floorFood == null || a.planFood == null) {
    return `🔥 ${Math.round(totals.calories || 0)} cal logged • budget assessment unavailable`;
  }
  const range = a.floorFood === a.planFood ? `${a.planFood}` : `${a.floorFood}–${a.planFood}`;
  const status = a.energyState === 'surplus' ? `${Math.round(a.surplusKcal)} cal above estimated maintenance`
    : a.planState === 'over' ? `${Math.round(a.overPlanKcal)} cal over plan`
      : `${Math.round(Math.max(0, a.planFood - a.food))} cal left`;
  return `🔥 ${Math.round(a.food)} / ${range} cal • ${status}${a.exercise > 0 ? ` • includes ${Math.round(a.exercise)} cal exercise adjustment` : ''}`;
}

export default buildReportCaption;
