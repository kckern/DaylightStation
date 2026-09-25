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
export function buildPostReportSnapshot({ date, timeOfDay, calories, protein, items, todayStatus = 'in_progress', recentPattern, weightTrend7d, recentCoaching, recentDays, minCalories }) {
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
    today_status: todayStatus,
    logging: loggingContext(minCalories),
    calories: {
      consumed: calories.consumed, goal_min: calories.goal_min, goal_max: calories.goal_max,
      // With the budget the percentage is NET of the plan's top, as the bar fills.
      pct: calories.goal_max > 0 ? Math.round(((calories.net ?? calories.consumed) / calories.goal_max) * 100) : 0,
      // From the budget contract when available: the zone the Today bar shows,
      // whether the log is trustworthy yet, and the headline's number.
      ...(calories.zone ? { zone: calories.zone, complete: calories.complete, remaining: calories.remaining } : {}),
      ...(calories.fasted_meals ? { fasted_meals: calories.fasted_meals } : {}),
    },
    protein: { consumed: protein.consumed, goal: protein.goal, pct: protein.goal > 0 ? Math.round((protein.consumed / protein.goal) * 100) : 0 },
    notable_items: notable,
    recent_pattern: recentPattern,
    weight_trend_7d: weightTrend7d,
    recent_days: (recentDays || []).map(pickDay),
    recent_coaching: recentCoaching || [],
  };
}

/**
 * Days carry a completeness `status` (dayCompleteness.mjs). Averages cover
 * trusted days only; `logging.note` tells the model what the statuses mean so
 * missing data is never narrated as low intake.
 *
 * @param {Object} opts
 * @param {string} opts.date
 * @param {{date, calories, protein, status}} opts.yesterday
 * @param {{calories, protein, trustedDays, totalDays}} opts.weekAvg
 * @param {number} opts.proteinGoal
 * @param {{current: number, trend7d: number}|null} opts.weight
 * @param {string|null} opts.recentPattern
 * @param {Array} opts.recentCoaching
 * @param {Array<{date, calories, protein, status}>} opts.recentDays
 * @param {number} opts.minCalories
 */
export function buildMorningBriefSnapshot({ date, yesterday, weekAvg, proteinGoal, weight, recentPattern, recentCoaching, recentDays, minCalories }) {
  return {
    type: 'morning-brief',
    date,
    time_of_day: 'morning',
    logging: loggingContext(minCalories),
    yesterday,
    week_avg: weekAvg,
    protein_goal: proteinGoal,
    weight: weight ? { current: weight.current, trend_7d: weight.trend7d } : null,
    recent_pattern: recentPattern,
    recent_days: (recentDays || []).slice(0, 7).map(pickDay),
    recent_coaching: recentCoaching || [],
  };
}

/**
 * @param {Object} opts
 * @param {{calories, protein, trustedDays, totalDays}} opts.thisWeek
 * @param {{calories, protein, trustedDays, totalDays}} opts.longTermAvg
 * @param {{weekStart: number, weekEnd: number, trend7d: number}|null} opts.weight
 * @param {Array} opts.recentCoaching
 * @param {Array<{date, calories, protein, status}>} opts.weekDays
 * @param {number} opts.minCalories
 */
export function buildWeeklyDigestSnapshot({ thisWeek, longTermAvg, weight, recentCoaching, weekDays, minCalories }) {
  return {
    type: 'weekly-digest',
    logging: loggingContext(minCalories),
    this_week: thisWeek,
    long_term_avg: longTermAvg,
    weight: weight ? { week_start: weight.weekStart, week_end: weight.weekEnd, trend_7d: weight.trend7d } : null,
    week_days: (weekDays || []).map(pickDay),
    recent_coaching: recentCoaching || [],
  };
}

function pickDay(d) {
  return { date: d.date, calories: d.calories, protein: d.protein, status: d.status, ...(d.fastedMeals ? { fasted_meals: d.fastedMeals } : {}) };
}

function loggingContext(minCalories) {
  return {
    min_calories: minCalories,
    note: 'status complete|done|fasting = trustworthy totals. reconstructed = an untracked day backfilled from weight: calories are an estimate, protein is UNKNOWN (ignore its protein figure) and there are no foods to mention. incomplete = under min_calories and not confirmed by the user: meals are missing, the total is NOT what was eaten. unlogged = no data. Averages cover trustworthy days only. fasted_meals = meals the user declared intentionally skipped: those meals are really empty (never ask about them), but the day is still incomplete unless it is closed or reaches min_calories — say which meals are still unlogged instead.',
  };
}

/**
 * @param {Object} opts
 * @param {{type: string, durationMin: number, caloriesBurned: number}} opts.activity
 * @param {number} opts.budgetImpact
 * @param {{consumed: number, goal_max: number}} opts.todayCalories
 * @param {Array} opts.recentCoaching
 */
export function buildExerciseReactionSnapshot({ activity, budgetImpact, todayCalories, todayStatus = 'in_progress', recentCoaching, budgetImpactNote = null }) {
  return {
    type: 'exercise-reaction',
    today_status: todayStatus,
    activity,
    budget_impact: budgetImpact,
    ...(budgetImpactNote ? { budget_impact_note: budgetImpactNote } : {}),
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
