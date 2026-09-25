// The daily report's caption line. With the health budget contract it states
// what the Today bar states — the goal range and the zone's own words ("782
// cal left", "109 cal over", "Fasted") — from the same counted food.
// Without it (no goals/weight yet), the legacy min/max wording stands.
import { headlineFor } from '#shared/contracts/health/budgetZone.mjs';

export function buildReportCaption({ totals = {}, goals = {}, budget = null }) {
  if (budget?.range && budget.zone) {
    const { floor, top } = budget.range;
    const range = floor === top ? `${top}` : `${floor}–${top}`;
    const h = headlineFor(budget);
    const status = h.value == null ? h.text : `${h.value} cal ${h.text}`;
    return `🔥 ${Math.round(budget.food)} / ${range} cal • ${status}`;
  }

  const calories = totals.calories || 0;
  const calorieMin = goals.calories_min || Math.round(goals.calories * 0.8);
  const calorieMax = goals.calories_max || goals.calories;
  let budgetStatus;
  if (calories < calorieMin) {
    budgetStatus = `${calorieMin - calories} cal below minimum`;
  } else if (calories > calorieMax) {
    budgetStatus = `${calories - calorieMax} cal over budget`;
  } else {
    const remaining = calorieMax - calories;
    budgetStatus = remaining > 0 ? `${remaining} cal remaining` : 'at goal ✓';
  }
  const caloriePercent = Math.round((calories / calorieMax) * 100);
  const goalDisplay = calorieMin !== calorieMax ? `${calorieMin}-${calorieMax}` : `${calorieMax}`;
  return `🔥 ${calories} / ${goalDisplay} cal (${caloriePercent}%) • ${budgetStatus}`;
}

export default buildReportCaption;
