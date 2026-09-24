import { CoachingMessageBuilder } from './CoachingMessageBuilder.mjs';
import { detectPattern } from './patterns.mjs';
import { buildCalendarDays, averageTrusted, resolveMinCalories, closureStatus } from './dayCompleteness.mjs';
import { buildPostReportSnapshot, buildMorningBriefSnapshot, buildWeeklyDigestSnapshot, buildExerciseReactionSnapshot, buildRecentCoaching, getTimeOfDay } from './snapshots.mjs';

/**
 * Coordinates data gathering → status block → LLM commentary → delivery → persistence.
 */
export class CoachingOrchestrator {
  #commentaryService;
  #messagingGateway;
  #healthStore;
  #nutriListStore;
  #config;
  #minCalories;
  #logger;

  /**
   * @param {Object} deps
   * @param {{min_calories?: number}} [deps.completeness] - household coaching.yml
   *   `logging_completeness`; days under min_calories without /done or /fast
   *   are treated as missing data, not low intake.
   */
  constructor({ commentaryService, messagingGateway, healthStore, nutriListStore, config, completeness, logger }) {
    this.#commentaryService = commentaryService;
    this.#messagingGateway = messagingGateway;
    this.#healthStore = healthStore;
    this.#nutriListStore = nutriListStore;
    this.#config = config;
    this.#minCalories = resolveMinCalories(completeness);
    this.#logger = logger || console;
  }

  /**
   * Post-meal coaching. Today only: a back-dated log is not a meal that just
   * happened. Today is in progress unless closed, so the snapshot says so and
   * the day is never judged as low. Each send replaces the day's previous
   * post-report message so a day of meals leaves one standing message.
   *
   * @param {Object} opts
   * @param {string} opts.userId
   * @param {string} opts.conversationId
   * @param {string} [opts.date] - defaults to the user's today
   * @param {{calories, protein}} [opts.totals] - defaults to the sum of the day's items
   */
  async sendPostReport({ userId, conversationId, date, totals }) {
    const today = this.#getToday(userId);
    date = date || today;
    try {
      if (date !== today) {
        this.#logger.info?.('coaching.post_report.skipped', { userId, date, reason: 'not-today' });
        return;
      }
      const goals = this.#config.getUserGoals(userId);
      const [coachingData, nutritionData, weightData, closures, items] = await Promise.all([
        this.#healthStore.loadCoachingData(userId).catch(() => ({})),
        this.#healthStore.loadNutritionData(userId).catch(() => ({})),
        this.#healthStore.loadWeightData(userId).catch(() => ({})),
        this.#loadClosures(userId),
        this.#nutriListStore.findByDate(userId, date).catch(() => []),
      ]);

      const dayTotals = this.#roundTotals(totals || this.#sumItems(items));
      if (!(dayTotals.calories > 0)) {
        this.#logger.info?.('coaching.post_report.skipped', { userId, date, reason: 'nothing-logged' });
        return;
      }

      const recentCoaching = buildRecentCoaching(coachingData);
      const recentDays = this.#getRecentDays(nutritionData, closures, date, 5);
      const pattern = detectPattern(recentDays, goals);
      const weightTrend = this.#getWeightTrend7d(weightData, date);
      const timeOfDay = getTimeOfDay(this.#config.getUserTimezone?.(userId));
      const calories = { consumed: dayTotals.calories, goal_min: goals.calories_min, goal_max: goals.calories_max || goals.calories };
      const protein = { consumed: dayTotals.protein, goal: goals.protein };

      const statusBlock = CoachingMessageBuilder.buildPostReportBlock({ calories, protein });

      const snapshot = buildPostReportSnapshot({
        date, timeOfDay, calories, protein, items,
        todayStatus: closureStatus(closures[date]) || 'in_progress',
        recentPattern: pattern, weightTrend7d: weightTrend, recentCoaching, recentDays,
        minCalories: this.#minCalories,
      });

      const commentary = await this.#commentaryService.generate(snapshot).catch(() => '');
      const message = statusBlock + CoachingMessageBuilder.wrapCommentary(commentary);

      const previous = this.#lastEntry(coachingData, date, 'post-report');
      const sent = await this.#messagingGateway.sendMessage(conversationId, message, { parseMode: 'HTML' });
      await this.#persistCoaching(userId, date, 'post-report', message, { messageId: sent?.messageId ?? null });
      if (previous?.messageId) {
        await this.#messagingGateway.deleteMessage?.(conversationId, previous.messageId)
          .catch(err => this.#logger.warn?.('coaching.post_report.supersede_failed', { userId, date, error: err.message }));
      }

      this.#logger.info?.('coaching.post_report.sent', { userId, date, hasCommentary: !!commentary, superseded: !!previous?.messageId });
    } catch (err) {
      this.#logger.error?.('coaching.post_report.failed', { userId, date, error: err.message });
    }
  }

  async sendMorningBrief({ userId, conversationId }) {
    try {
      const goals = this.#config.getUserGoals(userId);
      const today = this.#getToday(userId);
      const [coachingData, nutritionData, weightData, closures] = await Promise.all([
        this.#healthStore.loadCoachingData(userId).catch(() => ({})),
        this.#healthStore.loadNutritionData(userId).catch(() => ({})),
        this.#healthStore.loadWeightData(userId).catch(() => ({})),
        this.#loadClosures(userId),
      ]);

      const recentCoaching = buildRecentCoaching(coachingData);
      const recentDays = this.#getRecentDays(nutritionData, closures, today, 7);
      const yesterday = recentDays[0];
      const weekAvg = averageTrusted(recentDays);
      const pattern = detectPattern(recentDays, goals);
      const weight = this.#getWeightSnapshot(weightData, today);
      const minCalories = this.#minCalories;

      const statusBlock = CoachingMessageBuilder.buildMorningBriefBlock({
        yesterday, weekAvg, proteinGoal: goals.protein, weight, minCalories,
      });

      const snapshot = buildMorningBriefSnapshot({
        date: today, yesterday, weekAvg, proteinGoal: goals.protein,
        weight, recentPattern: pattern, recentCoaching, recentDays, minCalories,
      });

      const commentary = await this.#commentaryService.generate(snapshot).catch(() => '');
      const message = statusBlock + CoachingMessageBuilder.wrapCommentary(commentary);

      await this.#messagingGateway.sendMessage(conversationId, message, { parseMode: 'HTML' });
      await this.#persistCoaching(userId, today, 'morning-brief', message);

      this.#logger.info?.('coaching.morning_brief.sent', { userId, date: today, hasCommentary: !!commentary });
    } catch (err) {
      this.#logger.error?.('coaching.morning_brief.failed', { userId, error: err.message });
    }
  }

  async sendWeeklyDigest({ userId, conversationId }) {
    try {
      const goals = this.#config.getUserGoals(userId);
      const today = this.#getToday(userId);
      const [coachingData, nutritionData, weightData, closures] = await Promise.all([
        this.#healthStore.loadCoachingData(userId).catch(() => ({})),
        this.#healthStore.loadNutritionData(userId).catch(() => ({})),
        this.#healthStore.loadWeightData(userId).catch(() => ({})),
        this.#loadClosures(userId),
      ]);

      const recentCoaching = buildRecentCoaching(coachingData);
      const weekDays = this.#getRecentDays(nutritionData, closures, today, 7);
      const longTermDays = this.#getRecentDays(nutritionData, closures, today, 56);
      const thisWeek = averageTrusted(weekDays);
      const longTermAvg = averageTrusted(longTermDays);
      const weight = this.#getWeightSnapshotWeekly(weightData, today);

      const statusBlock = CoachingMessageBuilder.buildWeeklyDigestBlock({ thisWeek, longTermAvg, weight });

      const snapshot = buildWeeklyDigestSnapshot({
        thisWeek, longTermAvg, weight, recentCoaching, weekDays, minCalories: this.#minCalories,
      });

      const commentary = await this.#commentaryService.generate(snapshot).catch(() => '');
      const message = statusBlock + CoachingMessageBuilder.wrapCommentary(commentary);

      await this.#messagingGateway.sendMessage(conversationId, message, { parseMode: 'HTML' });
      await this.#persistCoaching(userId, today, 'weekly-digest', message);

      this.#logger.info?.('coaching.weekly_digest.sent', { userId, date: today, hasCommentary: !!commentary });
    } catch (err) {
      this.#logger.error?.('coaching.weekly_digest.failed', { userId, error: err.message });
    }
  }

  /**
   * @param {Object} opts
   * @param {{id?, type, durationMin, caloriesBurned}} opts.activity - `id` dedupes:
   *   the same activity never earns a second reaction.
   */
  async sendExerciseReaction({ userId, conversationId, activity }) {
    try {
      const goals = this.#config.getUserGoals(userId);
      const today = this.#getToday(userId);
      const [coachingData, closures, items] = await Promise.all([
        this.#healthStore.loadCoachingData(userId).catch(() => ({})),
        this.#loadClosures(userId),
        this.#nutriListStore.findByDate(userId, today).catch(() => []),
      ]);

      const activityId = activity.id != null ? String(activity.id) : null;
      if (activityId && Object.values(coachingData || {}).flat()
        .some(e => e?.type === 'exercise-reaction' && String(e.activityId) === activityId)) {
        this.#logger.info?.('coaching.exercise_reaction.skipped', { userId, activityId, reason: 'already-sent' });
        return;
      }

      const todayTotals = this.#roundTotals(this.#sumItems(items));
      const budgetImpact = Math.round(activity.caloriesBurned * 0.5);
      const recentCoaching = buildRecentCoaching(coachingData);

      const statusBlock = CoachingMessageBuilder.buildExerciseReactionBlock({ activity, budgetImpact });

      const snapshot = buildExerciseReactionSnapshot({
        activity, budgetImpact,
        todayCalories: { consumed: todayTotals.calories, goal_max: goals.calories_max || goals.calories },
        todayStatus: closureStatus(closures[today]) || 'in_progress',
        recentCoaching,
      });

      const commentary = await this.#commentaryService.generate(snapshot).catch(() => '');
      const message = statusBlock + CoachingMessageBuilder.wrapCommentary(commentary);

      const sent = await this.#messagingGateway.sendMessage(conversationId, message, { parseMode: 'HTML' });
      await this.#persistCoaching(userId, today, 'exercise-reaction', message, { messageId: sent?.messageId ?? null, activityId });

      this.#logger.info?.('coaching.exercise_reaction.sent', { userId, date: today, activityId, hasCommentary: !!commentary });
    } catch (err) {
      this.#logger.error?.('coaching.exercise_reaction.failed', { userId, error: err.message });
    }
  }

  // ── Private helpers ──

  #getToday(userId) {
    const tz = this.#config.getUserTimezone?.(userId) || 'America/Los_Angeles';
    return new Date().toLocaleDateString('en-CA', { timeZone: tz });
  }

  /** Calendar days before `beforeDate`, each classified for logging completeness. */
  #getRecentDays(nutritionData, closures, beforeDate, count) {
    return buildCalendarDays({ nutritionData, closures, beforeDate, count, minCalories: this.#minCalories });
  }

  /** Sum a day's ledger rows; group parents store zero so children count once. */
  #sumItems(items) {
    return (items || []).filter(i => i?.kind !== 'group').reduce((acc, i) => ({
      calories: acc.calories + (Number(i.calories) || 0),
      protein: acc.protein + (Number(i.protein) || 0),
    }), { calories: 0, protein: 0 });
  }

  #roundTotals(t) {
    return { calories: Math.round(Number(t?.calories) || 0), protein: Math.round(Number(t?.protein) || 0) };
  }

  #lastEntry(coachingData, date, type) {
    return (coachingData?.[date] || []).filter(e => e?.type === type).at(-1) || null;
  }

  async #loadClosures(userId) {
    try {
      return (await this.#healthStore.loadDayClosedData?.(userId)) || {};
    } catch {
      return {};
    }
  }

  /**
   * weight.yml rows carry `lbs` forward-filled every day and
   * `lbs_adjusted_average` as the smoothed trend line; read the smoothed value
   * so day-to-day water noise doesn't drive the weekly trend.
   */
  #weightValue(row) {
    if (typeof row === 'number') return row;
    const v = row?.lbs_adjusted_average ?? row?.lbs ?? row?.weight;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  /** @returns {{start: number, end: number}|null} latest value and the value ~7 days earlier */
  #weightSpan(weightData, today) {
    const dates = Object.keys(weightData || {})
      .filter(d => d <= today && this.#weightValue(weightData[d]) !== null)
      .sort().reverse();
    if (!dates.length) return null;
    const end = this.#weightValue(weightData[dates[0]]);
    const startDate = dates.find(d => this.#daysBetween(d, dates[0]) >= 6);
    const start = startDate ? this.#weightValue(weightData[startDate]) : end;
    return { start, end };
  }

  #getWeightTrend7d(weightData, date) {
    const span = this.#weightSpan(weightData, date);
    return span ? Math.round((span.end - span.start) * 100) / 100 : null;
  }

  #getWeightSnapshot(weightData, today) {
    const span = this.#weightSpan(weightData, today);
    if (!span) return null;
    return { current: span.end, trend7d: Math.round((span.end - span.start) * 100) / 100 };
  }

  #getWeightSnapshotWeekly(weightData, today) {
    const span = this.#weightSpan(weightData, today);
    if (!span) return null;
    return { weekStart: span.start, weekEnd: span.end, trend7d: Math.round((span.end - span.start) * 100) / 100 };
  }

  #daysBetween(dateA, dateB) {
    return Math.abs((new Date(dateB) - new Date(dateA)) / (24 * 60 * 60 * 1000));
  }

  async #persistCoaching(userId, date, type, text, extra = {}) {
    try {
      const data = await this.#healthStore.loadCoachingData(userId).catch(() => ({}));
      if (!data[date]) data[date] = [];
      data[date].push({ type, text, timestamp: new Date().toISOString(), ...extra });
      await this.#healthStore.saveCoachingData(userId, data);
    } catch (err) {
      this.#logger.warn?.('coaching.persist.failed', { userId, date, type, error: err.message });
    }
  }
}
