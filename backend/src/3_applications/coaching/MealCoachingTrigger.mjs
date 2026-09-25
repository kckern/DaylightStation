/**
 * Post-meal coaching trigger.
 *
 * A meal is rarely one capture — a photo, then a voice correction, then a
 * drink, often seconds apart. Each committed capture (or report) re-arms a
 * quiet timer; post-meal coaching fires once the log has been quiet for
 * `quietMinutes`, so one meal yields one message. Only the coached user (the
 * one with a coaching conversation) is coached; other household members'
 * captures are ignored rather than sent to someone else's chat.
 *
 * Only a change to TODAY arms it: logging yesterday's dinner is bookkeeping,
 * not a meal that just happened. A send that would land inside the overnight
 * quiet window is dropped (the next day's morning brief covers it).
 */

export const DEFAULT_QUIET_MINUTES = 10;
export const DEFAULT_QUIET_HOURS = Object.freeze({ start: '22:00', end: '07:00' });

export class MealCoachingTrigger {
  #getOrchestrator;
  #userId;
  #conversationId;
  #scheduler;
  #quietMs;
  #enabled;
  #quietHours;
  #today;
  #localTime;
  #logger;
  #timers = new Map();

  /**
   * @param {Object} deps
   * @param {() => {sendPostReport: Function}|null} deps.getOrchestrator - lazy; the
   *   orchestrator may be built after the capture pipeline
   * @param {string} deps.userId - the coached user
   * @param {string|null} deps.conversationId - where coaching is delivered
   * @param {{setTimeout: Function, clearTimeout: Function}} deps.scheduler
   * @param {{enabled?: boolean, quiet_minutes?: number, quiet_hours?: {start, end}|false}} [deps.config]
   *   coaching.yml `post_meal`
   * @param {() => string} deps.today - the coached user's local date, YYYY-MM-DD
   * @param {() => string} deps.localTime - the coached user's local time, HH:MM
   * @param {Object} [deps.logger]
   */
  constructor({ getOrchestrator, userId, conversationId, scheduler, config = {}, today, localTime, logger = console }) {
    if (!scheduler?.setTimeout || !scheduler?.clearTimeout) throw new Error('MealCoachingTrigger: scheduler required');
    this.#getOrchestrator = getOrchestrator;
    this.#userId = userId;
    this.#conversationId = conversationId;
    this.#scheduler = scheduler;
    const minutes = Number(config?.quiet_minutes);
    this.#quietMs = (Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_QUIET_MINUTES) * 60_000;
    this.#enabled = config?.enabled !== false;
    this.#quietHours = config?.quiet_hours === false ? null : { ...DEFAULT_QUIET_HOURS, ...(config?.quiet_hours || {}) };
    if (typeof today !== 'function' || typeof localTime !== 'function') throw new Error('MealCoachingTrigger: today and localTime required');
    this.#today = today;
    this.#localTime = localTime;
    this.#logger = logger;
  }

  /**
   * The food log for `userId` changed on `date` (a capture, report, or undo).
   * @param {{userId: string, date?: string|null, source?: string}} change - `date`
   *   is the log's meal date; unknown dates are treated as today
   * @returns {boolean} whether a coaching send is now armed
   */
  notify({ userId, date = null, source } = {}) {
    if (!this.#enabled || !this.#conversationId || !userId || userId !== this.#userId) return false;
    if (date && date !== this.#today()) {
      this.#logger.debug?.('coaching.meal_trigger.ignored', { userId, date, source, reason: 'not-today' });
      return false;
    }
    const existing = this.#timers.get(userId);
    if (existing) this.#scheduler.clearTimeout(existing);
    this.#timers.set(userId, this.#scheduler.setTimeout(() => this.#fire(userId), this.#quietMs));
    this.#logger.debug?.('coaching.meal_trigger.armed', { userId, source, rearmed: !!existing, quietMs: this.#quietMs });
    return true;
  }

  async #fire(userId) {
    this.#timers.delete(userId);
    if (this.#inQuietHours(this.#localTime())) {
      this.#logger.info?.('coaching.meal_trigger.dropped', { userId, reason: 'quiet-hours' });
      return;
    }
    const orchestrator = this.#getOrchestrator?.();
    if (!orchestrator?.sendPostReport) {
      this.#logger.warn?.('coaching.meal_trigger.no_orchestrator', { userId });
      return;
    }
    await orchestrator.sendPostReport({ userId, conversationId: this.#conversationId });
  }

  #inQuietHours(hhmm) {
    if (!this.#quietHours) return false;
    const { start, end } = this.#quietHours;
    return start <= end ? (hhmm >= start && hhmm < end) : (hhmm >= start || hhmm < end);
  }

  /** Cancel pending sends (shutdown / tests). */
  dispose() {
    for (const timer of this.#timers.values()) this.#scheduler.clearTimeout(timer);
    this.#timers.clear();
  }
}
