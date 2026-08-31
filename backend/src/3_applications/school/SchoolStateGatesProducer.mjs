import {
  studyDayForInstant, studyDayWindowForDate,
} from '#domains/school/studyDay.mjs';

const COMPLETE_STATES = new Set(['complete', 'no_work_today']);

function epoch(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.getTime();
}

/** Translate authoritative School day completion into State Gates evidence. */
export class SchoolStateGatesProducer {
  #realtime; #completion; #learners; #publish; #retract; #timezone; #clock; #scheduler; #logger; #refreshMs;
  #unsubscribe = null; #cancelRefresh = null; #cancelRollover = null; #stopped = false; #last = new Map(); #revisions = new Map(); #queues = new Map();

  constructor({
    realtime, getLearnerDayCompletion, learners, publishAssertion, retractAssertion,
    timezone = 'UTC', clock = () => new Date(), refreshMs = 15_000,
    scheduler, logger = console,
  } = {}) {
    if (!realtime?.onCompletionStateObserved || !getLearnerDayCompletion?.execute
      || typeof learners !== 'function' || typeof publishAssertion !== 'function'
      || typeof retractAssertion !== 'function'
      || typeof scheduler?.schedule !== 'function') {
      throw new Error('SchoolStateGatesProducer requires realtime, completion, learners, assertion ingress, and scheduler');
    }
    this.#realtime = realtime;
    this.#completion = getLearnerDayCompletion;
    this.#learners = learners;
    this.#publish = publishAssertion;
    this.#retract = retractAssertion;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#scheduler = scheduler;
    this.#refreshMs = refreshMs;
    this.#logger = logger;
  }

  async start() {
    this.#stopped = false;
    if (!this.#unsubscribe) {
      this.#unsubscribe = this.#realtime.onCompletionStateObserved((fact) => (
        this.#enqueue(fact).catch((error) => this.#warn('observe-failed', error, fact?.learnerId))
      ));
    }
    await this.reconcile();
    this.#armRefresh();
    this.#armRollover();
  }

  stop() {
    this.#stopped = true;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#cancelRefresh?.();
    this.#cancelRefresh = null;
    this.#cancelRollover?.();
    this.#cancelRollover = null;
  }

  async reconcile() {
    let roster;
    try {
      roster = await this.#learners();
    } catch (error) {
      this.#warn('reconcile-roster-failed', error);
      return;
    }
    await Promise.all((roster ?? []).map(async (learner) => {
      const learnerId = learner?.id ?? learner?.learnerId;
      if (!learnerId) return;
      try {
        const fact = await this.#completion.execute({ learnerId });
        await this.#enqueue({ learnerId, ...fact });
      } catch (error) {
        this.#warn('reconcile-learner-failed', error, learnerId);
      }
    }));
  }

  #nowMs() {
    const value = this.#clock();
    return epoch(value);
  }

  #nextRevision(assertionId, observedAt) {
    const candidate = Math.max(1, Math.trunc(observedAt));
    const next = Math.max(candidate, (this.#revisions.get(assertionId) ?? 0) + 1);
    this.#revisions.set(assertionId, next);
    return next;
  }

  #enqueue(fact) {
    const learnerId = typeof fact?.learnerId === 'string' ? fact.learnerId.trim() : '';
    if (!learnerId) return Promise.resolve();
    const previous = this.#queues.get(learnerId) ?? Promise.resolve();
    const queued = previous.catch(() => {}).then(() => this.#observe({ ...fact, learnerId }));
    this.#queues.set(learnerId, queued);
    return queued.finally(() => {
      if (this.#queues.get(learnerId) === queued) this.#queues.delete(learnerId);
    });
  }

  async #observe({ learnerId, state, studyDate }) {
    const now = this.#nowMs();
    const currentStudyDate = studyDayForInstant(now, { timezone: this.#timezone });
    const day = typeof studyDate === 'string' ? studyDate : currentStudyDate;
    const period = studyDayWindowForDate(day, { timezone: this.#timezone });
    // A delayed event from yesterday must not create a newly-valid old fact.
    if (!period || now < period.startAtMs || now >= period.endAtMs) return;

    const assertionId = `school:day-complete:${learnerId}:${day}`;
    if (state === 'indeterminate') {
      if (this.#last.get(assertionId) === state) return;
      try {
        await this.#retract({
          assertionId,
          sourceRevision: this.#nextRevision(assertionId, now),
          retractedAt: now,
          evidenceRef: 'school-completion:indeterminate',
        });
      } catch (error) {
        // No evidence is already the correct State Gates representation of an
        // indeterminate School day. Every other refusal is material.
        if (error?.code !== 'ASSERTION_NOT_FOUND') throw error;
      }
      this.#last.set(assertionId, state);
      return;
    }
    const value = COMPLETE_STATES.has(state);
    const signature = `${state}:${value}`;
    if (this.#last.get(assertionId) === signature) return;

    await this.#publish({
      assertionId,
      claimTypeId: 'school.day.complete',
      subject: { kind: 'learner', id: learnerId },
      period: {
        kind: 'interval', id: `school-day:${day}`,
        startsAt: period.startAtMs, endsAt: period.endAtMs,
      },
      value,
      sourceRevision: this.#nextRevision(assertionId, now),
      observedAt: now,
      validFrom: now,
      validUntil: period.endAtMs,
      evidenceRef: `school-completion:${state ?? 'unknown'}`,
    });
    this.#last.set(assertionId, signature);
  }

  #armRefresh() {
    if (this.#stopped) return;
    this.#cancelRefresh?.();
    this.#cancelRefresh = this.#scheduler.schedule(this.#refreshMs, async () => {
      this.#cancelRefresh = null;
      try { await this.reconcile(); } finally { this.#armRefresh(); }
    });
  }

  #armRollover() {
    if (this.#stopped) return;
    this.#cancelRollover?.();
    this.#cancelRollover = null;
    const now = this.#nowMs();
    const day = studyDayForInstant(now, { timezone: this.#timezone });
    const window = studyDayWindowForDate(day, { timezone: this.#timezone });
    if (!window) return;
    const delay = Math.max(1, Math.min(2_147_000_000, window.endAtMs - now + 25));
    this.#cancelRollover = this.#scheduler.schedule(delay, async () => {
      this.#cancelRollover = null;
      try { await this.reconcile(); } finally { this.#armRollover(); }
    });
  }

  #warn(event, error, learnerId = null) {
    this.#logger.warn?.(`state-gates.school.${event}`, {
      ...(learnerId ? { learnerId } : {}), error: error?.message ?? String(error),
    });
  }
}

export default SchoolStateGatesProducer;
