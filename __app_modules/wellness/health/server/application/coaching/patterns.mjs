/** Recent days are most recent first; judgments come only from daily assessments. */
export function detectPattern(days, goals = {}) {
  if (!days?.length) return null;
  if (['incomplete', 'unlogged'].includes(days[0].status)) return 'missed_logging';
  const eligible = day => day.assessment?.availability === 'available'
    && day.assessment.finished && day.assessment.trustworthy;
  const trusted = days.filter(eligible);
  const last3 = trusted.slice(0, 3);
  if (last3.filter(day => day.assessment.energyState === 'surplus').length >= 2) return 'energy_surplus';
  if (last3.filter(day => day.assessment.planState === 'over').length >= 2) return 'over_plan';
  const proteinTarget = goals.protein;
  if (!(typeof proteinTarget === 'number' && Number.isFinite(proteinTarget) && proteinTarget > 0)) return null;
  const knownProtein = day => day.assessment.proteinKnown && typeof day.protein === 'number' && Number.isFinite(day.protein);
  if (trusted.slice(0, 5).filter(day => knownProtein(day) && day.protein < proteinTarget * 0.8).length >= 3) return 'protein_short';
  if (days.length >= 3 && days.slice(0, 3).every(day => eligible(day)
    && day.assessment.planState === 'within' && knownProtein(day) && day.protein >= proteinTarget)) return 'on_track';
  return null;
}
