/**
 * Watches the watchers.
 *
 * A meter that stops measuring looks exactly like a house where nobody is
 * playing: no events, no errors, no sessions. That symmetry is the danger this
 * component exists to break. Silence is not evidence of quiet, so the health of
 * each tracker is inspected on its own schedule and anything wrong is said out
 * loud.
 *
 * Three conditions, each a different kind of wrong:
 *
 *  - **Stale** — no tick within the tolerance. The loop has stopped, hung, or
 *    is wedged behind a probe that never returns. This is the serious one,
 *    because it is the one that is otherwise invisible.
 *  - **Failing** — ticks are happening and erroring. The device is unreachable
 *    or answering badly; we know we cannot see.
 *  - **Degraded** — observations arrive but cannot confirm playing versus
 *    paused, so time may be over-counted. Not a failure; a measurably worse
 *    meter, and worth knowing before the numbers are questioned.
 *
 * Alarms are edge-triggered: a condition is announced when it starts and when it
 * clears, not on every sweep. A watchdog that repeats itself every interval is
 * one people learn to filter out.
 */
export class PlayObservationWatchdog {
  #trackers; #scheduler; #now; #logger;
  #staleAfterMs; #errorThreshold; #intervalMs;
  #cancel = null; #running = false;
  #active = new Map();

  constructor({
    trackers = [], scheduler, now, logger = console,
    staleAfterMs, errorThreshold = 3, intervalMs,
  }) {
    if (typeof scheduler?.after !== 'function') throw new Error('PlayObservationWatchdog requires a scheduler with after()');
    if (typeof now !== 'function') throw new Error('PlayObservationWatchdog requires an injected now()');
    if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) throw new Error('PlayObservationWatchdog requires a positive staleAfterMs');
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('PlayObservationWatchdog requires a positive intervalMs');
    this.#trackers = trackers;
    this.#scheduler = scheduler;
    this.#now = now;
    this.#logger = logger;
    this.#staleAfterMs = staleAfterMs;
    this.#errorThreshold = errorThreshold;
    this.#intervalMs = intervalMs;
  }

  get isRunning() { return this.#running; }

  start() {
    if (this.#running) return this;
    this.#running = true;
    this.#schedule();
    return this;
  }

  stop() {
    this.#running = false;
    this.#cancel?.();
    this.#cancel = null;
    return this;
  }

  #schedule() {
    if (!this.#running) return;
    this.#cancel = this.#scheduler.after(this.#intervalMs, () => {
      try { this.check(); } catch (error) {
        this.#logger.error?.('play.watchdog.failed', { error: error.message });
      }
      this.#schedule();
    });
  }

  /** One sweep. Returns the conditions currently active, for tests and probes. */
  check() {
    const at = Date.parse(this.#now());
    const found = [];

    for (const tracker of this.#trackers) {
      for (const health of tracker.getHealth()) {
        const { deviceId, lastTickAt, consecutiveErrors = 0, degraded, lastError } = health;

        // A tracker that has never ticked is not yet stale — it may have only
        // just started. Staleness needs a previous success to be measured from.
        const age = lastTickAt ? at - Date.parse(lastTickAt) : null;
        const stale = age !== null && age > this.#staleAfterMs;
        const failing = consecutiveErrors >= this.#errorThreshold;

        this.#edge(deviceId, 'stale', stale, 'error', {
          ageMs: age, staleAfterMs: this.#staleAfterMs,
          note: 'no observation within tolerance — the meter may be blind while play continues',
        });
        this.#edge(deviceId, 'failing', failing, 'warn', { consecutiveErrors, lastError });
        this.#edge(deviceId, 'degraded', degraded === true, 'warn', {
          note: 'observations arriving but playing-versus-paused unconfirmed; played time may be over-counted',
        });

        if (stale) found.push({ deviceId, condition: 'stale' });
        if (failing) found.push({ deviceId, condition: 'failing' });
        if (degraded === true) found.push({ deviceId, condition: 'degraded' });
      }
    }
    return found;
  }

  /** Announce only on transitions, so an alarm stays worth reading. */
  #edge(deviceId, condition, isActive, level, detail) {
    const key = `${deviceId}:${condition}`;
    const wasActive = this.#active.get(key) === true;
    if (isActive === wasActive) return;
    this.#active.set(key, isActive);
    if (isActive) {
      this.#logger[level]?.(`play.watchdog.${condition}`, { deviceId, ...detail });
    } else {
      this.#logger.info?.(`play.watchdog.${condition}_cleared`, { deviceId });
    }
  }
}

export default PlayObservationWatchdog;
