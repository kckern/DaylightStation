/**
 * Build pre-computed data snapshots for LLM commentary.
 * Each builder takes raw data from datastores and returns a compact JSON object.
 */

/**
 * @param {Object} opts
 * @param {string} opts.date - Report date (YYYY-MM-DD)
 * @param {string} opts.timeOfDay - 'morning' | 'afternoon' | 'evening'
 * @param {{consumed: number, goal_min: number, goal_max: number}} opts.calories
 * @param {{consumed: number, goal: number}} opts.protein
 * @param {Array<{name: string, calories: number, protein: number}>} opts.items - Today's food items
 * @param {string|null} opts.recentPattern - Pattern from detectPattern()
 * @param {number|null} opts.weightTrend7d
 * @param {Array<{type: string, hours_ago: number, text: string}>} opts.recentCoaching
 */
export function buildPostReportSnapshot({ date, timeOfDay, calories, protein, items, recentPattern, weightTrend7d, recentCoaching }) {
  // Pick top 3 notable items by protein contribution, then calories
  const notable = (items || [])
    .filter(i => i.calories > 0)
    .sort((a, b) => (b.protein || 0) - (a.protein || 0) || (b.calories || 0) - (a.calories || 0))
    .slice(0, 3)
    .map(i => {
      const parts = [i.name || 'Unknown'];
      if (i.protein > 0) parts.push(`${Math.round(i.protein)}g protein`);
      return parts.join(' (') + (parts.length > 1 ? ')' : '');
    });

  return {
    type: 'post-report',
    date,
    time_of_day: timeOfDay,
    calories: { consumed: calories.consumed, goal_min: calories.goal_min, goal_max: calories.goal_max, pct: calories.goal_max > 0 ? Math.round((calories.consumed / calories.goal_max) * 100) : 0 },
    protein: { consumed: protein.consumed, goal: protein.goal, pct: protein.goal > 0 ? Math.round((protein.consumed / protein.goal) * 100) : 0 },
    notable_items: notable,
    recent_pattern: recentPattern,
    weight_trend_7d: weightTrend7d,
    recent_coaching: recentCoaching || [],
  };
}

/**
 * @param {Object} opts
 * @param {string} opts.date
 * @param {{calories: number, protein: number}} opts.yesterday
 * @param {{calories: number, protein: number}} opts.weekAvg
 * @param {number} opts.proteinGoal
 * @param {{current: number, trend7d: number}} opts.weight
 * @param {string|null} opts.recentPattern
 * @param {Array} opts.recentCoaching
 * @param {Array<{date: string, calories: number, protein: number}>} opts.recentDays - Last 7 days for context
 */
export function buildMorningBriefSnapshot({ date, yesterday, weekAvg, proteinGoal, weight, recentPattern, recentCoaching, recentDays }) {
  return {
    type: 'morning-brief',
    date,
    time_of_day: 'morning',
    yesterday,
    week_avg: weekAvg,
    protein_goal: proteinGoal,
    weight: { current: weight.current, trend_7d: weight.trend7d },
    recent_pattern: recentPattern,
    recent_days: (recentDays || []).slice(0, 7).map(d => ({ date: d.date, calories: d.calories, protein: d.protein })),
    recent_coaching: recentCoaching || [],
  };
}

/**
 * @param {Object} opts
 * @param {{avgCalories: number, avgProtein: number}} opts.thisWeek
 * @param {{avgCalories: number, avgProtein: number}} opts.longTermAvg
 * @param {{weekStart: number, weekEnd: number, trend7d: number}} opts.weight
 * @param {Array} opts.recentCoaching
 * @param {Array<{date: string, calories: number, protein: number}>} opts.weekDays - This week's daily data
 */
export function buildWeeklyDigestSnapshot({ thisWeek, longTermAvg, weight, recentCoaching, weekDays }) {
  return {
    type: 'weekly-digest',
    this_week: thisWeek,
    long_term_avg: longTermAvg,
    weight: { week_start: weight.weekStart, week_end: weight.weekEnd, trend_7d: weight.trend7d },
    week_days: (weekDays || []).map(d => ({ date: d.date, calories: d.calories, protein: d.protein })),
    recent_coaching: recentCoaching || [],
  };
}

/**
 * @param {Object} opts
 * @param {{type: string, durationMin: number, caloriesBurned: number}} opts.activity
 * @param {number} opts.budgetImpact
 * @param {{consumed: number, goal_max: number}} opts.todayCalories
 * @param {Array} opts.recentCoaching
 */
export function buildExerciseReactionSnapshot({ activity, budgetImpact, todayCalories, recentCoaching }) {
  return {
    type: 'exercise-reaction',
    activity,
    budget_impact: budgetImpact,
    today_calories: todayCalories,
    recent_coaching: recentCoaching || [],
  };
}

/**
 * Build recent_coaching array from coaching history.
 * @param {Object} coachingData - Keyed by date, each value is array of {type, text, timestamp}
 * @param {number} [windowDays=4] - How many days back to include
 * @returns {Array<{type: string, hours_ago: number, text: string}>}
 */
export function buildRecentCoaching(coachingData, windowDays = 4) {
  if (!coachingData) return [];

  const now = Date.now();
  const cutoff = now - windowDays * 24 * 60 * 60 * 1000;
  const entries = [];

  for (const [date, messages] of Object.entries(coachingData)) {
    for (const msg of messages) {
      const ts = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;
      if (ts < cutoff) continue;
      entries.push({
        type: msg.type,
        hours_ago: Math.round((now - ts) / (60 * 60 * 1000)),
        text: (msg.text || '').slice(0, 200),
      });
    }
  }

  return entries.sort((a, b) => a.hours_ago - b.hours_ago);
}

/**
 * Determine time of day from timezone.
 * @param {string} [timezone='America/Los_Angeles']
 * @returns {'morning' | 'afternoon' | 'evening'}
 */
export function getTimeOfDay(timezone = 'America/Los_Angeles') {
  const hour = new Date().toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false });
  const h = parseInt(hour, 10);
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}
