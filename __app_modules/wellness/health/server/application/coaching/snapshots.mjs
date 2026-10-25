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
export function buildPostReportSnapshot({ date, timeOfDay, calories, protein, items, todayStatus = 'in_progress', recentPattern, weightTrend7d, recentCoaching, recentDays, minCalories, evidence }) {
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
    ...evidenceContext(evidence),
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
export function buildMorningBriefSnapshot({ date, yesterday, weekAvg, proteinGoal, weight, recentPattern, recentCoaching, recentDays, minCalories, evidence }) {
  return {
    type: 'morning-brief',
    ...evidenceContext(evidence),
    date,
    time_of_day: 'morning',
    logging: loggingContext(minCalories),
    yesterday: yesterday ? pickDay(yesterday) : null,
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
export function buildWeeklyDigestSnapshot({ thisWeek, longTermAvg, weight, recentCoaching, weekDays, minCalories, evidence, longTermPeriod }) {
  return {
    type: 'weekly-digest',
    ...evidenceContext(evidence),
    ...(longTermPeriod ? { long_term_period: longTermPeriod } : {}),
    logging: loggingContext(minCalories),
    this_week: thisWeek,
    long_term_avg: longTermAvg,
    weight: weight ? { week_start: weight.weekStart, week_end: weight.weekEnd, trend_7d: weight.trend7d } : null,
    week_days: (weekDays || []).map(pickDay),
    recent_coaching: recentCoaching || [],
  };
}

function pickDay(day) {
  return {
    date: day.date, calories: day.calories, protein: day.protein, status: day.status,
    ...(day.declared ? { declared: day.declared } : {}),
    ...(day.assessment ? { assessment: day.assessment, provenance: day.provenance } : {}),
    ...(day.estimatedCalories != null ? { estimated_calories: day.estimatedCalories } : {}),
    ...(day.fastedMeals ? { fasted_meals: day.fastedMeals } : {}),
  };
}

function evidenceContext(evidence) {
  return evidence ? { period: evidence.period, source_state: evidence.sourceState,
    today: evidence.today, timezone: evidence.timezone, current_assessment: evidence.current.assessment } : {};
}

function loggingContext(minCalories) {
  return {
    min_calories: minCalories,
    note: 'Status describes logging; assessment controls intake judgments. Only finished trustworthy assessments enter averages and patterns. Incomplete means missing meals, not low intake; use each assessment.floorFood for its date rather than one window-wide floor. Unlogged means no data; unavailable means the source could not be read. Reconstructed estimated_calories is a separate estimate; calories remains canonical measured food and supports no intake verdict for that row. Reconstructed protein is unknown. Protein is known only when assessment.proteinKnown is true. Missing budget assessments stay unavailable, never inferred from summary calories. goalBasis current means current configured goals apply to historical dates, not recovered historical goal versions. fasted_meals are intentionally skipped meals: never ask about those meals. A skipped meal can make logging complete but does not finish a live day',
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
