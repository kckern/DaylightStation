import { CoachingMessageBuilder } from './CoachingMessageBuilder.mjs';
import { detectPattern } from './patterns.mjs';
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
  #logger;

  constructor({ commentaryService, messagingGateway, healthStore, nutriListStore, config, logger }) {
    this.#commentaryService = commentaryService;
    this.#messagingGateway = messagingGateway;
    this.#healthStore = healthStore;
    this.#nutriListStore = nutriListStore;
    this.#config = config;
    this.#logger = logger || console;
  }

  async sendPostReport({ userId, conversationId, date, totals }) {
    try {
      const goals = this.#config.getUserGoals(userId);
      const [coachingData, nutritionData, weightData, items] = await Promise.all([
        this.#healthStore.loadCoachingData(userId).catch(() => ({})),
        this.#healthStore.loadNutritionData(userId).catch(() => ({})),
        this.#healthStore.loadWeightData(userId).catch(() => ({})),
        this.#nutriListStore.findByDate(userId, date).catch(() => []),
      ]);

      const recentCoaching = buildRecentCoaching(coachingData);
      const recentDays = this.#getRecentDays(nutritionData, date, 5);
      const pattern = detectPattern(recentDays, goals);
      const weightTrend = this.#getWeightTrend7d(weightData, date);
      const timeOfDay = getTimeOfDay(this.#config.getUserTimezone?.(userId));

      const statusBlock = CoachingMessageBuilder.buildPostReportBlock({
        calories: { consumed: totals.calories, goal_min: goals.calories_min, goal_max: goals.calories_max || goals.calories },
        protein: { consumed: totals.protein, goal: goals.protein },
      });

      const snapshot = buildPostReportSnapshot({
        date, timeOfDay,
        calories: { consumed: totals.calories, goal_min: goals.calories_min, goal_max: goals.calories_max || goals.calories },
        protein: { consumed: totals.protein, goal: goals.protein },
        items, recentPattern: pattern, weightTrend7d: weightTrend, recentCoaching,
      });

      const commentary = await this.#commentaryService.generate(snapshot).catch(() => '');
      const message = statusBlock + CoachingMessageBuilder.wrapCommentary(commentary);

      await this.#messagingGateway.sendMessage(conversationId, message, { parseMode: 'HTML' });
      await this.#persistCoaching(userId, date, 'post-report', message);

      this.#logger.info?.('coaching.post_report.sent', { userId, date, hasCommentary: !!commentary });
    } catch (err) {
      this.#logger.error?.('coaching.post_report.failed', { userId, date, error: err.message });
    }
  }

  async sendMorningBrief({ userId, conversationId }) {
    try {
      const goals = this.#config.getUserGoals(userId);
      const today = this.#getToday(userId);
      const [coachingData, nutritionData, weightData] = await Promise.all([
        this.#healthStore.loadCoachingData(userId).catch(() => ({})),
        this.#healthStore.loadNutritionData(userId).catch(() => ({})),
        this.#healthStore.loadWeightData(userId).catch(() => ({})),
      ]);

      const recentCoaching = buildRecentCoaching(coachingData);
      const recentDays = this.#getRecentDays(nutritionData, today, 7);
      const yesterday = recentDays[0] || { calories: 0, protein: 0 };
      const weekAvg = this.#computeAvg(recentDays);
      const pattern = detectPattern(recentDays, goals);
      const weight = this.#getWeightSnapshot(weightData, today);

      const statusBlock = CoachingMessageBuilder.buildMorningBriefBlock({
        yesterday, weekAvg, proteinGoal: goals.protein, weight,
      });

      const snapshot = buildMorningBriefSnapshot({
        date: today, yesterday, weekAvg, proteinGoal: goals.protein,
        weight, recentPattern: pattern, recentCoaching, recentDays,
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
      const [coachingData, nutritionData, weightData] = await Promise.all([
        this.#healthStore.loadCoachingData(userId).catch(() => ({})),
        this.#healthStore.loadNutritionData(userId).catch(() => ({})),
        this.#healthStore.loadWeightData(userId).catch(() => ({})),
      ]);

      const recentCoaching = buildRecentCoaching(coachingData);
      const weekDays = this.#getRecentDays(nutritionData, today, 7);
      const longTermDays = this.#getRecentDays(nutritionData, today, 56);
      const thisWeek = this.#computeAvg(weekDays);
      const longTermAvg = this.#computeAvg(longTermDays);
      const weight = this.#getWeightSnapshotWeekly(weightData, today);

      const statusBlock = CoachingMessageBuilder.buildWeeklyDigestBlock({
        thisWeek: { avgCalories: thisWeek.calories, avgProtein: thisWeek.protein },
        longTermAvg: { avgCalories: longTermAvg.calories, avgProtein: longTermAvg.protein },
        weight,
      });

      const snapshot = buildWeeklyDigestSnapshot({
        thisWeek: { avgCalories: thisWeek.calories, avgProtein: thisWeek.protein },
        longTermAvg: { avgCalories: longTermAvg.calories, avgProtein: longTermAvg.protein },
        weight, recentCoaching, weekDays,
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

  async sendExerciseReaction({ userId, conversationId, activity }) {
    try {
      const goals = this.#config.getUserGoals(userId);
      const today = this.#getToday(userId);
      const [coachingData, nutritionData] = await Promise.all([
        this.#healthStore.loadCoachingData(userId).catch(() => ({})),
        this.#healthStore.loadNutritionData(userId).catch(() => ({})),
      ]);

      const todayNutrition = nutritionData[today] || { calories: 0 };
      const budgetImpact = Math.round(activity.caloriesBurned * 0.5);
      const recentCoaching = buildRecentCoaching(coachingData);

      const statusBlock = CoachingMessageBuilder.buildExerciseReactionBlock({ activity, budgetImpact });

      const snapshot = buildExerciseReactionSnapshot({
        activity, budgetImpact,
        todayCalories: { consumed: todayNutrition.calories, goal_max: goals.calories_max || goals.calories },
        recentCoaching,
      });

      const commentary = await this.#commentaryService.generate(snapshot).catch(() => '');
      const message = statusBlock + CoachingMessageBuilder.wrapCommentary(commentary);

      await this.#messagingGateway.sendMessage(conversationId, message, { parseMode: 'HTML' });
      await this.#persistCoaching(userId, today, 'exercise-reaction', message);

      this.#logger.info?.('coaching.exercise_reaction.sent', { userId, date: today, hasCommentary: !!commentary });
    } catch (err) {
      this.#logger.error?.('coaching.exercise_reaction.failed', { userId, error: err.message });
    }
  }

  // ── Private helpers ──

  #getToday(userId) {
    const tz = this.#config.getUserTimezone?.(userId) || 'America/Los_Angeles';
    return new Date().toLocaleDateString('en-CA', { timeZone: tz });
  }

  #getRecentDays(nutritionData, beforeDate, count) {
    return Object.keys(nutritionData || {})
      .filter(d => d < beforeDate)
      .sort()
      .reverse()
      .slice(0, count)
      .map(d => ({
        date: d,
        calories: nutritionData[d]?.calories || 0,
        protein: nutritionData[d]?.protein || 0,
      }));
  }

  #computeAvg(days) {
    if (!days.length) return { calories: 0, protein: 0 };
    const sum = days.reduce((acc, d) => ({ calories: acc.calories + d.calories, protein: acc.protein + d.protein }), { calories: 0, protein: 0 });
    return { calories: Math.round(sum.calories / days.length), protein: Math.round(sum.protein / days.length) };
  }

  #getWeightTrend7d(weightData, date) {
    const dates = Object.keys(weightData || {}).filter(d => d <= date).sort().reverse();
    if (dates.length < 2) return null;
    const recent = weightData[dates[0]]?.weight || weightData[dates[0]];
    const weekAgo = dates.find((d, i) => i > 0 && this.#daysBetween(d, dates[0]) >= 6);
    if (!weekAgo) return null;
    const older = weightData[weekAgo]?.weight || weightData[weekAgo];
    if (typeof recent !== 'number' || typeof older !== 'number') return null;
    return Math.round((recent - older) * 100) / 100;
  }

  #getWeightSnapshot(weightData, today) {
    const dates = Object.keys(weightData || {}).filter(d => d <= today).sort().reverse();
    const current = dates[0] ? (weightData[dates[0]]?.weight || weightData[dates[0]]) : null;
    const trend7d = this.#getWeightTrend7d(weightData, today);
    return { current: typeof current === 'number' ? current : 0, trend7d: trend7d || 0 };
  }

  #getWeightSnapshotWeekly(weightData, today) {
    const dates = Object.keys(weightData || {}).filter(d => d <= today).sort().reverse();
    const weekEnd = dates[0] ? (weightData[dates[0]]?.weight || weightData[dates[0]]) : 0;
    const weekStartDate = dates.find(d => this.#daysBetween(d, dates[0]) >= 6);
    const weekStart = weekStartDate ? (weightData[weekStartDate]?.weight || weightData[weekStartDate]) : weekEnd;
    return {
      weekStart: typeof weekStart === 'number' ? weekStart : 0,
      weekEnd: typeof weekEnd === 'number' ? weekEnd : 0,
      trend7d: typeof weekEnd === 'number' && typeof weekStart === 'number' ? Math.round((weekEnd - weekStart) * 100) / 100 : 0,
    };
  }

  #daysBetween(dateA, dateB) {
    return Math.abs((new Date(dateB) - new Date(dateA)) / (24 * 60 * 60 * 1000));
  }

  async #persistCoaching(userId, date, type, text) {
    try {
      const data = await this.#healthStore.loadCoachingData(userId).catch(() => ({}));
      if (!data[date]) data[date] = [];
      data[date].push({ type, text, timestamp: new Date().toISOString() });
      await this.#healthStore.saveCoachingData(userId, data);
    } catch (err) {
      this.#logger.warn?.('coaching.persist.failed', { userId, date, type, error: err.message });
    }
  }
}
