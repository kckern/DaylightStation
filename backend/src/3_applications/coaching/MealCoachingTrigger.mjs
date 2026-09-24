/**
 * Post-meal coaching trigger.
 *
 * A meal is rarely one capture — a photo, then a voice correction, then a
 * drink, often seconds apart. Each committed capture (or report) re-arms a
 * quiet timer; post-meal coaching fires once the log has been quiet for
 * `quietMinutes`, so one meal yields one message. Only the coached user (the
 * one with a coaching conversation) is coached; other household members'
 * captures are ignored rather than sent to someone else's chat.
 */

export const DEFAULT_QUIET_MINUTES = 10;

export class MealCoachingTrigger {
  #getOrchestrator;
  #userId;
  #conversationId;
  #scheduler;
  #quietMs;
  #enabled;
  #logger;
  #timers = new Map();

  /**
   * @param {Object} deps
   * @param {() => {sendPostReport: Function}|null} deps.getOrchestrator - lazy; the
   *   orchestrator may be built after the capture pipeline
   * @param {string} deps.userId - the coached user
   * @param {string|null} deps.conversationId - where coaching is delivered
   * @param {{setTimeout: Function, clearTimeout: Function}} deps.scheduler
   * @param {{enabled?: boolean, quiet_minutes?: number}} [deps.config] - coaching.yml `post_meal`
   * @param {Object} [deps.logger]
   */
  constructor({ getOrchestrator, userId, conversationId, scheduler, config = {}, logger = console }) {
    if (!scheduler?.setTimeout || !scheduler?.clearTimeout) throw new Error('MealCoachingTrigger: scheduler required');
    this.#getOrchestrator = getOrchestrator;
    this.#userId = userId;
    this.#conversationId = conversationId;
    this.#scheduler = scheduler;
    const minutes = Number(config?.quiet_minutes);
    this.#quietMs = (Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_QUIET_MINUTES) * 60_000;
    this.#enabled = config?.enabled !== false;
    this.#logger = logger;
  }

  /**
   * A capture committed or a report was generated for `userId`.
   * @returns {boolean} whether a coaching send is now armed
   */
  notify({ userId, source } = {}) {
    if (!this.#enabled || !this.#conversationId || !userId || userId !== this.#userId) return false;
    const existing = this.#timers.get(userId);
    if (existing) this.#scheduler.clearTimeout(existing);
    this.#timers.set(userId, this.#scheduler.setTimeout(() => this.#fire(userId), this.#quietMs));
    this.#logger.debug?.('coaching.meal_trigger.armed', { userId, source, rearmed: !!existing, quietMs: this.#quietMs });
    return true;
  }

  async #fire(userId) {
    this.#timers.delete(userId);
    const orchestrator = this.#getOrchestrator?.();
    if (!orchestrator?.sendPostReport) {
      this.#logger.warn?.('coaching.meal_trigger.no_orchestrator', { userId });
      return;
    }
    await orchestrator.sendPostReport({ userId, conversationId: this.#conversationId });
  }

  /** Cancel pending sends (shutdown / tests). */
  dispose() {
    for (const timer of this.#timers.values()) this.#scheduler.clearTimeout(timer);
    this.#timers.clear();
  }
}
