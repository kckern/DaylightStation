import moment from 'moment';

/**
 * How far through a budget period we are, in weeks.
 * `progress` is clamped to [0, 1] so chart markers never render off-axis
 * (viewing a completed budget previously produced a negative plot position).
 */
export function budgetProgress(budgetStart, budgetEnd, now = undefined) {
  const weekCount = moment(budgetEnd).diff(moment(budgetStart), 'weeks');
  if (weekCount <= 0) return { weekCount, currentWeek: 0, weeksLeft: 0, progress: 1 };
  const currentWeek = moment(now).diff(moment(budgetStart), 'weeks');
  const progress = Math.min(1, Math.max(0, currentWeek / weekCount));
  return { weekCount, currentWeek, weeksLeft: Math.max(0, weekCount - currentWeek), progress };
}
