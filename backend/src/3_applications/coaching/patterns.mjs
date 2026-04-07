/**
 * Detect the most notable recent nutrition pattern.
 * @param {Array<{date: string, calories: number, protein: number}>} days - Recent daily data, most recent first
 * @param {{calories_min: number, calories_max: number, protein: number}} goals
 * @returns {string|null} Pattern identifier or null
 */
export function detectPattern(days, goals) {
  if (!days || days.length === 0) return null;

  const last3 = days.slice(0, 3);
  const last5 = days.slice(0, 5);

  // binge_after_deficit: today > max, preceded by 2+ days < min
  if (last3.length >= 3) {
    const todayOver = last3[0].calories > goals.calories_max;
    const prev2Under = last3.slice(1, 3).every(d => d.calories < goals.calories_min && d.calories > 0);
    if (todayOver && prev2Under) return 'binge_after_deficit';
  }

  // missed_logging: 0 calories for 1+ of last 3 days
  if (last3.some(d => d.calories === 0)) return 'missed_logging';

  // calorie_surplus: above goal_max for 2+ of last 3 days
  const surplusDays = last3.filter(d => d.calories > goals.calories_max);
  if (surplusDays.length >= 2) return 'calorie_surplus';

  // calorie_deficit: below goal_min for 2+ of last 3 days
  const deficitDays = last3.filter(d => d.calories < goals.calories_min && d.calories > 0);
  if (deficitDays.length >= 2) return 'calorie_deficit';

  // protein_short: protein < 80% of goal for 3+ of last 5 days
  const proteinThreshold = goals.protein * 0.8;
  const proteinShortDays = last5.filter(d => d.protein < proteinThreshold && d.calories > 0);
  if (proteinShortDays.length >= 3) return 'protein_short';

  // on_track: within goals for 3+ consecutive days from most recent
  const onTrackStreak = last3.filter(d =>
    d.calories >= goals.calories_min &&
    d.calories <= goals.calories_max &&
    d.protein >= goals.protein
  );
  if (onTrackStreak.length >= 3) return 'on_track';

  return null;
}
