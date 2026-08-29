/**
 * SchoolCompletionBridge (design: 2026-08-23-student-completion-state-machine,
 * §5) — subscribes to every settled session (`school.session.outcome-recorded`,
 * published by `CloseSessionOutcome#settle`, which covers curriculum AND
 * language days since `CloseLanguageDay` routes through the same `#settle`),
 * recomputes the learner's day completion, and publishes
 * `school.completion.state-observed` on the first observation after startup
 * and on actual state transitions. Consumers can therefore rebuild after a
 * restart without pretending the first observation was a transition.
 *
 * Completion truth never depends on this bridge having fired: any consumer
 * can call `GetLearnerDayCompletion` directly at any time and get the same
 * answer. This bridge is a push convenience for subscribers that would
 * otherwise have to poll, never the source of truth — so a getLearnerDayCompletion
 * failure here is swallowed and logged, exactly like `DoNowSchoolBridge`'s
 * own handler-threw guard.
 *
 * Consumers must be idempotent by learnerId+studyDate because a restart can
 * legitimately publish the same derived state again with `initial: true`.
 */
export class SchoolCompletionBridge {
  #realtime; #getCompletion; #clock; #logger; #unsubscribe; #lastState; #learnerQueues;

  constructor({
    realtime, getLearnerDayCompletion, clock = () => new Date(), logger = console,
  } = {}) {
    if (!realtime?.onSessionOutcomeRecorded || !realtime?.completionStateObserved || !getLearnerDayCompletion) {
      throw new Error('SchoolCompletionBridge requires realtime and getLearnerDayCompletion');
    }
    this.#realtime = realtime;
    this.#getCompletion = getLearnerDayCompletion;
    this.#clock = clock;
    this.#logger = logger;
    this.#unsubscribe = null;
    this.#lastState = new Map();
    this.#learnerQueues = new Map();
  }

  /** Subscribe to `school.session.outcome-recorded`. Safe to call more than once. */
  start() {
    if (this.#unsubscribe) return;
    this.#unsubscribe = this.#realtime.onSessionOutcomeRecorded((payload) => (
      this.#enqueue(payload).catch((err) => {
        this.#logger.warn?.('school.completion-bridge.handler-threw', { error: err?.message ?? String(err) });
      })
    ));
  }

  /** Unsubscribe. Safe to call more than once, and safe to call before `start()`. */
  stop() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  /** Serialize recomputations for one learner while allowing different
   * learners to proceed independently. EventBus publish is synchronous and
   * does not await async subscribers, so without this queue two outcomes can
   * finish their reads in reverse order and corrupt #lastState. */
  #enqueue(payload) {
    const learnerId = payload?.learnerId;
    if (typeof learnerId !== 'string' || !learnerId.trim()) return Promise.resolve();
    const previous = this.#learnerQueues.get(learnerId) ?? Promise.resolve();
    const queued = previous.catch(() => {}).then(() => this.#handle(payload));
    this.#learnerQueues.set(learnerId, queued);
    return queued.finally(() => {
      if (this.#learnerQueues.get(learnerId) === queued) this.#learnerQueues.delete(learnerId);
    });
  }

  async #handle(payload) {
    const learnerId = payload?.learnerId;
    if (typeof learnerId !== 'string' || !learnerId.trim()) return;
    const { state, studyDate } = await this.#getCompletion.execute({ learnerId });
    const previousState = this.#lastState.get(learnerId);
    this.#lastState.set(learnerId, state);
    if (previousState === state) return;
    this.#realtime.completionStateObserved({
      learnerId, studyDate, state,
      previousState: previousState ?? null,
      initial: previousState === undefined,
      at: this.#clock().toISOString(),
    });
  }
}

export default SchoolCompletionBridge;
