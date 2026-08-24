/**
 * SchoolCompletionBridge (design: 2026-08-23-student-completion-state-machine,
 * §5) — subscribes to every settled session (`school.session.outcome-recorded`,
 * published by `CloseSessionOutcome#settle`, which covers curriculum AND
 * language days since `CloseLanguageDay` routes through the same `#settle`),
 * recomputes the learner's day completion, and publishes
 * `school.completion.changed` ONLY on an actual state transition — never on
 * every recompute, so a rapid sequence of passes or a flapping launcher does
 * not spam the bus.
 *
 * Completion truth never depends on this bridge having fired: any consumer
 * can call `GetLearnerDayCompletion` directly at any time and get the same
 * answer. This bridge is a push convenience for subscribers that would
 * otherwise have to poll, never the source of truth — so a getLearnerDayCompletion
 * failure here is swallowed and logged, exactly like `DoNowSchoolBridge`'s
 * own handler-threw guard.
 *
 * In-memory last-seen-state per learner, reset on process restart: the
 * first state observed for a learner after startup is never treated as a
 * transition (there is no prior state to compare against) — acceptable,
 * since completion is purely derived and any consumer's own direct read
 * after restart already reflects the current state correctly.
 */
export class SchoolCompletionBridge {
  #eventBus; #getCompletion; #clock; #logger; #unsubscribe; #lastState;

  constructor({
    eventBus, getLearnerDayCompletion, clock = () => new Date(), logger = console,
  } = {}) {
    if (!eventBus || typeof eventBus.subscribe !== 'function' || !getLearnerDayCompletion) {
      throw new Error('SchoolCompletionBridge requires eventBus and getLearnerDayCompletion');
    }
    this.#eventBus = eventBus;
    this.#getCompletion = getLearnerDayCompletion;
    this.#clock = clock;
    this.#logger = logger;
    this.#unsubscribe = null;
    this.#lastState = new Map();
  }

  /** Subscribe to `school.session.outcome-recorded`. Safe to call more than once. */
  start() {
    if (this.#unsubscribe) return;
    this.#unsubscribe = this.#eventBus.subscribe('school.session.outcome-recorded', (payload) => (
      this.#handle(payload).catch((err) => {
        this.#logger.warn?.('school.completion-bridge.handler-threw', { error: err?.message ?? String(err) });
      })
    ));
  }

  /** Unsubscribe. Safe to call more than once, and safe to call before `start()`. */
  stop() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  async #handle(payload) {
    const learnerId = payload?.learnerId;
    if (typeof learnerId !== 'string' || !learnerId.trim()) return;
    const { state } = await this.#getCompletion.execute({ learnerId });
    const previousState = this.#lastState.get(learnerId);
    this.#lastState.set(learnerId, state);
    if (previousState === undefined || previousState === state) return;
    this.#eventBus.publish('school.completion.changed', {
      learnerId, state, previousState, at: this.#clock().toISOString(),
    });
  }
}

export default SchoolCompletionBridge;
