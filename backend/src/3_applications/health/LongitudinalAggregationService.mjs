/**
 * LongitudinalAggregationService — assembles 30-day daily and 26-week weekly
 * aggregated health data from existing YAML datastores.
 */
export class LongitudinalAggregationService {
  #sessionDatastore;
  #healthStore;

  constructor({ sessionDatastore, healthStore }) {
    this.#sessionDatastore = sessionDatastore;
    this.#healthStore = healthStore;
  }

  async aggregate(userId) {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Date range for daily: 30 days
    const dailyStart = new Date(today);
    dailyStart.setDate(dailyStart.getDate() - 29);
    const dailyStartStr = dailyStart.toISOString().split('T')[0];

    // Date range for weekly: 26 weeks (~182 days)
    const weeklyStart = new Date(today);
    weeklyStart.setDate(weeklyStart.getDate() - 182);
    const weeklyStartStr = weeklyStart.toISOString().split('T')[0];

    // Load all data sources in parallel
    const [sessions, weight, nutrition, fitness, reconciliation] = await Promise.all([
      this.#sessionDatastore.findInRange(weeklyStartStr, todayStr, null).catch(() => []),
      this.#healthStore.loadWeightData(userId).catch(() => ({})),
      this.#healthStore.loadNutritionData(userId).catch(() => ({})),
      this.#healthStore.loadFitnessData(userId).catch(() => ({})),
      this.#healthStore.loadReconciliationData(userId).catch(() => ({})),
    ]);

    // Index sessions by date
    const sessionsByDate = {};
    for (const s of sessions) {
      const d = s.date;
      if (!d) continue;
      if (!sessionsByDate[d]) sessionsByDate[d] = [];
      sessionsByDate[d].push(s);
    }

    // Build daily entries (30 days)
    const daily = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()];

      const daySessions = sessionsByDate[dateStr] || [];
      const exerciseMinutes = Math.round(
        daySessions.reduce((sum, s) => sum + (s.durationMs || 0), 0) / 60000
      );
      const caloriesBurned = daySessions.reduce(
        (sum, s) => sum + (s.strava?.calories || 0), 0
      ) || (exerciseMinutes > 0 ? null : 0);

      daily.push({
        date: dateStr,
        dayOfWeek: dow,
        exerciseMinutes,
        caloriesBurned: caloriesBurned || 0,
        steps: fitness[dateStr]?.steps?.steps_count ?? null,
        protein: nutrition[dateStr]?.protein ?? null,
        calorieBalance: reconciliation[dateStr]?.calorie_adjustment ?? null,
      });
    }

    // Build weekly entries (26 weeks)
    const weekly = [];
    // Find the Monday of the current week
    const currentDay = today.getDay(); // 0=Sun
    const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay;
    const thisMonday = new Date(today);
    thisMonday.setDate(thisMonday.getDate() + mondayOffset);

    for (let w = 25; w >= 0; w--) {
      const weekStart = new Date(thisMonday);
      weekStart.setDate(weekStart.getDate() - w * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      const wsStr = weekStart.toISOString().split('T')[0];
      const weStr = weekEnd.toISOString().split('T')[0];
      const label = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      // Collect daily data for this week
      const weightVals = [];
      const weightBalanceVals = [];
      let exCals = 0;
      const hrVals = [];

      for (let d = 0; d < 7; d++) {
        const day = new Date(weekStart);
        day.setDate(day.getDate() + d);
        const dayStr = day.toISOString().split('T')[0];

        if (weight[dayStr]?.lbs_adjusted_average) {
          weightVals.push(weight[dayStr].lbs_adjusted_average);
        }
        if (weight[dayStr]?.calorie_balance != null) {
          weightBalanceVals.push(weight[dayStr].calorie_balance);
        }

        const daySessions = sessionsByDate[dayStr] || [];
        for (const s of daySessions) {
          exCals += s.strava?.calories || 0;
          if (s.strava?.avgHeartrate) hrVals.push(s.strava.avgHeartrate);
        }
      }

      const mean = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : null;

      weekly.push({
        weekStart: wsStr,
        weekEnd: weStr,
        label,
        avgWeight: mean(weightVals),
        weightCalorieBalance: mean(weightBalanceVals),
        exerciseCalories: exCals || 0,
        avgExerciseHr: mean(hrVals),
      });
    }

    return { daily, weekly };
  }
}
