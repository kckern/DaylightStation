/**
 * HealthDashboardUseCase - Orchestrates the unified health dashboard response.
 *
 * Composes existing services: AggregateHealthUseCase, SessionService,
 * EntropyService, LifePlanService, and HistoryAggregator.
 * No direct adapter calls — all I/O through injected ports.
 */

import { rollUpHistory } from '#domains/health/services/HistoryAggregator.mjs';

export class HealthDashboardUseCase {
  #healthService;
  #sessionService;
  #entropyService;
  #lifePlanRepository;
  #healthStore;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.healthService - AggregateHealthUseCase
   * @param {Object} config.sessionService - SessionService (fitness)
   * @param {Object} config.entropyService - EntropyService
   * @param {Object} config.lifePlanRepository - ILifePlanRepository
   * @param {Object} config.healthStore - IHealthDataDatastore
   * @param {Object} [config.logger]
   */
  constructor(config) {
    if (!config.healthService) throw new Error('HealthDashboardUseCase requires healthService');
    if (!config.healthStore) throw new Error('HealthDashboardUseCase requires healthStore');

    this.#healthService = config.healthService;
    this.#sessionService = config.sessionService || null;
    this.#entropyService = config.entropyService || null;
    this.#lifePlanRepository = config.lifePlanRepository || null;
    this.#healthStore = config.healthStore;
    this.#logger = config.logger || console;
  }

  /**
   * Build the full dashboard response.
   * @param {string} userId - Username
   * @returns {Promise<Object>} Dashboard data
   */
  async execute(userId) {
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    this.#logger.debug?.('health.dashboard.start', { userId, today });

    // Load all data in parallel
    const [
      healthData,
      todaySessions,
      entropyReport,
      lifePlan,
      coachingData,
    ] = await Promise.all([
      this.#healthService.execute(userId, 730, now).catch(err => {
        this.#logger.error?.('health.dashboard.healthData.error', { error: err.message });
        return {};
      }),
      this.#loadTodaySessions(today),
      this.#loadEntropy(userId),
      this.#loadGoals(userId),
      this.#healthStore.loadCoachingData(userId).catch(() => ({})),
    ]);

    // Today's snapshot
    const todayMetric = healthData?.[today] || {};
    const todayCoaching = this.#extractTodayCoaching(coachingData, today);

    // Build today section
    const todaySection = {
      date: today,
      weight: todayMetric.weight || null,
      nutrition: todayMetric.nutrition || null,
      sessions: todaySessions,
      coaching: todayCoaching,
    };

    // Recency tracker from entropy
    const recency = entropyReport?.items?.map(item => ({
      source: item.source,
      name: item.name,
      lastUpdate: item.lastUpdate,
      daysSince: item.value,
      status: item.status,
    })) || [];

    // Active fitness goals from life plan
    const goals = this.#extractActiveGoals(lifePlan);

    // Historical tiers
    const allDays = Object.values(healthData || {}).filter(d => d?.date);
    const history = rollUpHistory(allDays);

    this.#logger.debug?.('health.dashboard.complete', {
      userId,
      hasWeight: !!todaySection.weight,
      sessionCount: todaySessions.length,
      recencyCount: recency.length,
      goalCount: goals.length,
      historyDays: history.daily.length,
      historyWeeks: history.weekly.length,
      historyMonths: history.monthly.length,
    });

    return { today: todaySection, recency, goals, history };
  }

  async #loadTodaySessions(today) {
    if (!this.#sessionService) return [];
    try {
      const sessions = await this.#sessionService.listSessionsByDate(today);
      return (sessions || []).map(s => ({
        sessionId: s.sessionId || s.session?.id,
        title: s.media?.primary?.title || null,
        showTitle: s.media?.primary?.showTitle || null,
        durationMs: s.durationMs,
        totalCoins: s.totalCoins || 0,
        participants: s.participants ? Object.keys(s.participants) : [],
      }));
    } catch (err) {
      this.#logger.error?.('health.dashboard.sessions.error', { error: err.message });
      return [];
    }
  }

  async #loadEntropy(userId) {
    if (!this.#entropyService) return { items: [] };
    try {
      return await this.#entropyService.getReport(userId);
    } catch (err) {
      this.#logger.error?.('health.dashboard.entropy.error', { error: err.message });
      return { items: [] };
    }
  }

  async #loadGoals(userId) {
    if (!this.#lifePlanRepository) return null;
    try {
      return await this.#lifePlanRepository.load(userId);
    } catch (err) {
      this.#logger.error?.('health.dashboard.goals.error', { error: err.message });
      return null;
    }
  }

  #extractTodayCoaching(coachingData, today) {
    if (!coachingData || typeof coachingData !== 'object') return [];
    // Coaching data is keyed by date or has entries with date field
    const todayEntries = coachingData[today];
    if (Array.isArray(todayEntries)) return todayEntries;
    if (todayEntries && typeof todayEntries === 'object') return [todayEntries];
    return [];
  }

  #extractActiveGoals(lifePlan) {
    if (!lifePlan) return [];
    // Goals are in lifePlan.goals or lifePlan.goalProgress, filtered by active state
    const goals = lifePlan.goals || lifePlan.goalProgress || [];
    return goals
      .filter(g => g.state === 'committed' || g.state === 'active')
      .map(g => ({
        id: g.id,
        name: g.name,
        state: g.state,
        metrics: g.metrics || [],
        deadline: g.deadline || null,
      }));
  }
}
