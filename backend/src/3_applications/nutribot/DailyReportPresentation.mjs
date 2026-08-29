function localDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const sum = (items, key) => items.reduce((total, item) => total + (Number(item?.[key]) || 0), 0);

/** Build all nutrition selection and aggregation before presentation rendering. */
export function prepareDailyReportPresentation({ date, totals = {}, goals = {}, items = [], history = [] }) {
  const grouped = new Map();
  for (const item of items) {
    const current = grouped.get(item.name);
    if (!current) grouped.set(item.name, { ...item });
    else for (const key of ['calories', 'carbs', 'protein', 'fat', 'grams']) {
      current[key] = (current[key] || 0) + (item[key] || 0);
    }
  }
  const foodItems = [...grouped.values()].sort((a, b) => (b.calories || 0) - (a.calories || 0));
  const macroGrams = {
    protein: totals.protein || sum(items, 'protein'),
    carbs: totals.carbs || sum(items, 'carbs'),
    fat: totals.fat || sum(items, 'fat'),
  };
  const microTotals = Object.fromEntries(['sodium', 'fiber', 'sugar', 'cholesterol']
    .map((key) => [key, sum(items, key)]));
  const totalCalories = Math.round(totals.calories || sum(items, 'calories'));
  const historyByDate = new Map(history.map((day) => [day.date, day]));
  const [year, month, day] = String(date).split('-').map(Number);
  const baseDate = new Date(year, month - 1, day);
  const chartDays = [];
  for (let offset = 6; offset >= 0; offset--) {
    const current = new Date(baseDate);
    current.setDate(current.getDate() - offset);
    const dayDate = localDateString(current);
    chartDays.push(historyByDate.get(dayDate) || (offset === 0
      ? { date: dayDate, calories: sum(items, 'calories'), protein: sum(items, 'protein'), carbs: sum(items, 'carbs'), fat: sum(items, 'fat') }
      : { date: dayDate, calories: 0, protein: 0, carbs: 0, fat: 0 }));
  }
  return { date, totals, goals, items: foodItems, history, macroGrams, microTotals, totalCalories, chartDays };
}

export default prepareDailyReportPresentation;
