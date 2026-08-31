import moment from 'moment-timezone';

function addDays(day, count) {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + count * 86_400_000)
    .toISOString().slice(0, 10);
}

/** Translate the roster-wide weekly measures projection into State Gates evidence. */
export class WeeklyMeasuresStateGatesProducer {
  #weekly; #publish; #timezone; #clock; #scheduler; #logger; #debounceMs; #refreshMs;
  #cancelRefresh = null; #cancelPoll = null; #cancelRollover = null; #stopped = false; #last = new Map(); #revisions = new Map(); #running = null;

  constructor({
    weeklyMeasures, publishAssertion, timezone = 'UTC', clock = () => new Date(),
    debounceMs = 500, refreshMs = 5 * 60 * 1000, scheduler, logger = console,
  } = {}) {
    if (!weeklyMeasures?.execute || typeof publishAssertion !== 'function'
      || typeof scheduler?.schedule !== 'function') {
      throw new Error('WeeklyMeasuresStateGatesProducer requires weeklyMeasures, publishAssertion, and scheduler');
    }
    this.#weekly = weeklyMeasures;
    this.#publish = publishAssertion;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#scheduler = scheduler;
    this.#debounceMs = debounceMs;
    this.#refreshMs = refreshMs;
    this.#logger = logger;
  }

  async start() {
    this.#stopped = false;
    await this.reconcile();
    this.#armPoll();
    this.#armRollover();
  }

  stop() {
    this.#stopped = true;
    this.#cancelRefresh?.();
    this.#cancelPoll?.();
    this.#cancelRollover?.();
    this.#cancelRefresh = null;
    this.#cancelPoll = null;
    this.#cancelRollover = null;
  }

  /** Coalesce chatty session saves into one roster-wide projection refresh. */
  requestReconcile() {
    if (this.#stopped) return;
    if (this.#cancelRefresh) return;
    this.#cancelRefresh = this.#scheduler.schedule(this.#debounceMs, () => {
      this.#cancelRefresh = null;
      this.reconcile().catch((error) => this.#warn('reconcile-failed', error));
    });
  }

  async reconcile() {
    if (this.#running) return this.#running;
    this.#running = this.#reconcile().finally(() => { this.#running = null; });
    return this.#running;
  }

  #nowMs() {
    const value = this.#clock();
    return (value instanceof Date ? value : new Date(value)).getTime();
  }

  #period(window) {
    const start = moment.tz(`${window.from} 04:00`, 'YYYY-MM-DD HH:mm', true, this.#timezone);
    const endDay = addDays(window.to, 1);
    const end = moment.tz(`${endDay} 04:00`, 'YYYY-MM-DD HH:mm', true, this.#timezone);
    if (!start.isValid() || !end.isValid()) return null;
    return {
      kind: 'interval', id: `fitness-week:${window.from}:${window.to}`,
      startsAt: start.valueOf(), endsAt: end.valueOf(),
    };
  }

  #nextRevision(assertionId, observedAt) {
    const candidate = Math.max(1, Math.trunc(observedAt));
    const next = Math.max(candidate, (this.#revisions.get(assertionId) ?? 0) + 1);
    this.#revisions.set(assertionId, next);
    return next;
  }

  async #reconcile() {
    let projection;
    try {
      projection = await this.#weekly.execute();
    } catch (error) {
      this.#warn('read-failed', error);
      return;
    }
    const period = this.#period(projection?.window ?? {});
    const now = this.#nowMs();
    if (!period || now < period.startsAt || now >= period.endsAt) return;

    await Promise.all((projection.learners ?? []).map(async (row) => {
      const rings = (row.measures ?? []).find((measure) => measure.id === 'fitness.rings');
      if (!row.learnerId || !Number.isFinite(rings?.value)) return;
      const assertionId = `fitness:weekly-rings:${row.learnerId}:${projection.window.from}:${projection.window.to}`;
      const signature = String(rings.value);
      if (this.#last.get(assertionId) === signature) return;
      try {
        await this.#publish({
          assertionId,
          claimTypeId: 'fitness.weekly.rings',
          subject: { kind: 'learner', id: row.learnerId },
          period,
          value: rings.value,
          sourceRevision: this.#nextRevision(assertionId, now),
          observedAt: now,
          validFrom: now,
          validUntil: period.endsAt,
          evidenceRef: `fitness-week:${projection.window.from}:${projection.window.to}`,
        });
        this.#last.set(assertionId, signature);
      } catch (error) {
        this.#warn('publish-failed', error, row.learnerId);
      }
    }));
  }

  #armPoll() {
    if (this.#stopped) return;
    this.#cancelPoll?.();
    this.#cancelPoll = this.#scheduler.schedule(this.#refreshMs, async () => {
      this.#cancelPoll = null;
      try { await this.reconcile(); } finally { this.#armPoll(); }
    });
  }

  #armRollover() {
    if (this.#stopped) return;
    this.#cancelRollover?.();
    this.#cancelRollover = null;
    const now = this.#nowMs();
    this.#weekly.execute().then((projection) => {
      if (this.#stopped) return;
      const period = this.#period(projection?.window ?? {});
      if (!period) return;
      const delay = Math.max(1, Math.min(2_147_000_000, period.endsAt - now + 25));
      this.#cancelRollover = this.#scheduler.schedule(delay, async () => {
        this.#cancelRollover = null;
        try { await this.reconcile(); } finally { this.#armRollover(); }
      });
    }).catch((error) => this.#warn('rollover-arm-failed', error));
  }

  #warn(event, error, learnerId = null) {
    this.#logger.warn?.(`state-gates.fitness.${event}`, {
      ...(learnerId ? { learnerId } : {}), error: error?.message ?? String(error),
    });
  }
}

export default WeeklyMeasuresStateGatesProducer;
