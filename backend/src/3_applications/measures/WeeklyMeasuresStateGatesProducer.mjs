import moment from 'moment-timezone';

function addDays(day, count) {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + count * 86_400_000)
    .toISOString().slice(0, 10);
}

/** Translate the roster-wide weekly measures projection into State Gates evidence. */
export class WeeklyMeasuresStateGatesProducer {
  #weekly; #publish; #timezone; #clock; #scheduler; #logger; #debounceMs; #savedDebounceMs; #refreshMs;
  #pending = null; #cancelPoll = null; #cancelRollover = null; #stopped = false; #last = new Map(); #revisions = new Map(); #running = null; #rerun = false;

  constructor({
    weeklyMeasures, publishAssertion, timezone = 'UTC', clock = () => new Date(),
    debounceMs = 500, // prompt path; savedDebounceMs is the coalescing path
    savedDebounceMs = 60 * 1000, refreshMs = 5 * 60 * 1000, scheduler, logger = console,
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
    this.#savedDebounceMs = savedDebounceMs;
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
    this.#rerun = false; // a stopped producer must not fire a trailing re-run
    this.#pending?.cancel();
    this.#cancelPoll?.();
    this.#cancelRollover?.();
    this.#pending = null;
    this.#cancelPoll = null;
    this.#cancelRollover = null;
  }

  /**
   * Coalesce session changes into one roster-wide projection refresh.
   *
   * Only a plain autosave (`operation: 'saved'` — every 15 s from every open
   * session) takes the slow `savedDebounceMs` path: the rings only need to
   * catch up eventually. Everything else takes the prompt `debounceMs` path
   * — ended, deleted, an unrecognised operation, or no change object at all.
   * That denylist is deliberate: a new operation must opt IN to being
   * delayed, so it can never be demoted to a minute-late reconcile by
   * someone adding a case elsewhere.
   *
   * An already-pending request wins if it is at least as prompt; otherwise
   * the prompt request cancels and replaces it. So repeated saves ride one
   * window rather than pushing it back, and an ending session upgrades a
   * pending save. Before this, every 15 s save drove a full per-learner
   * publish against a multi-megabyte YAML re-parse — the 2026-09-02
   * event-loop stall.
   *
   * The pending delay and its cancel handle live in ONE object so they
   * cannot drift apart: a half-updated pair would make the guard compare
   * against null, which reads as "always at least as prompt" and would wedge
   * every later request silently. For the same reason the struct is dropped
   * again if `schedule` throws — a pending record with no armed timer would
   * absorb every later request forever — and a scheduler that hands back a
   * non-function is left with the no-op cancel rather than breaking `stop()`.
   */
  requestReconcile(change = {}) {
    if (this.#stopped) return;
    const delayMs = change?.operation === 'saved' ? this.#savedDebounceMs : this.#debounceMs;
    if (this.#pending) {
      if (delayMs >= this.#pending.delayMs) return;
      this.#pending.cancel();
    }
    const pending = { delayMs, cancel: () => {} };
    this.#pending = pending;
    let cancel;
    try {
      cancel = this.#scheduler.schedule(delayMs, () => {
        if (this.#pending === pending) this.#pending = null;
        this.reconcile().catch((error) => this.#warn('reconcile-failed', error));
      });
    } catch (error) {
      if (this.#pending === pending) this.#pending = null;
      this.#warn('schedule-failed', error);
      return;
    }
    if (this.#pending === pending && typeof cancel === 'function') pending.cancel = cancel;
  }

  async reconcile() {
    if (this.#running) { this.#rerun = true; return this.#running; }
    this.#running = this.#reconcile().finally(() => {
      this.#running = null;
      if (this.#rerun) {
        this.#rerun = false;
        // A request arrived after the in-flight run had already read the
        // projection, so its data was never seen. Re-run once rather than
        // dropping it — otherwise an end-of-session reconcile lands behind a
        // 60s autosave reconcile and the final rings wait for the 5-min poll.
        this.reconcile().catch((error) => this.#warn('reconcile-failed', error));
      }
    });
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

    // Sequential on purpose. Every publish is a compare-and-swap on ONE
    // household revision with a 3-attempt cap; in parallel the last learner
    // in roster order lost every cycle ("State Gates state changed
    // concurrently") and never had rings published at all, while the wasted
    // retries re-parsed the whole state file 18x per cycle.
    for (const row of projection.learners ?? []) {
      const rings = (row.measures ?? []).find((measure) => measure.id === 'fitness.rings');
      if (!row.learnerId || !Number.isFinite(rings?.value)) continue;
      const assertionId = `fitness:weekly-rings:${row.learnerId}:${projection.window.from}:${projection.window.to}`;
      const signature = String(rings.value);
      if (this.#last.get(assertionId) === signature) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
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
    }
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
