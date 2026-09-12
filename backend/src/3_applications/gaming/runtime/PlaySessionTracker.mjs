/**
 * Drives observation of every play surface that must be watched from outside.
 *
 * Surfaces that report their own lifecycle do not appear here — they push
 * straight into `RecordPlayObservation`. This runtime exists only for surfaces
 * we can watch but not instrument, and its whole job is to turn "check on a
 * timer" into the same observations a self-reporting surface would emit.
 *
 * Scheduling notes that matter:
 *
 *  - Ticks are chained, not intervalled. A slow or hung probe delays the next
 *    check rather than stacking a queue of overlapping ones behind it.
 *  - Each device is guarded independently, so one unreachable device cannot
 *    stall or crash the others.
 *  - A failed tick is recorded, never swallowed. Silence must not be
 *    indistinguishable from an idle device, so health is observable and a
 *    watchdog can alarm on staleness rather than on nothing at all.
 *
 * Timers and clocks are injected: this layer owns no globals.
 */
export class PlaySessionTracker {
  #devices; #source; #intents; #record; #intervalMs;
  #setTimer; #clearTimer; #now; #logger;
  #timer = null; #running = false;
  #inFlight = new Set();
  #health = new Map();

  constructor({
    devices = [], observationSource, intents, recordObservation,
    intervalMs, setTimer, clearTimer, now, logger = console,
  }) {
    if (!observationSource?.observe) throw new Error('PlaySessionTracker requires an observationSource');
    if (!recordObservation?.execute) throw new Error('PlaySessionTracker requires recordObservation');
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('PlaySessionTracker requires a positive intervalMs');
    if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') {
      throw new Error('PlaySessionTracker requires injected setTimer/clearTimer');
    }
    if (typeof now !== 'function') throw new Error('PlaySessionTracker requires an injected now()');
    this.#devices = devices;
    this.#source = observationSource;
    this.#intents = intents || null;
    this.#record = recordObservation;
    this.#intervalMs = intervalMs;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
    this.#now = now;
    this.#logger = logger;
  }

  get isRunning() { return this.#running; }

  start() {
    if (this.#running) return this;
    this.#running = true;
    this.#logger.info?.('play.tracker.started', {
      devices: this.#devices.map((d) => d.deviceId), intervalMs: this.#intervalMs,
    });
    this.#schedule();
    return this;
  }

  stop() {
    this.#running = false;
    if (this.#timer !== null) this.#clearTimer(this.#timer);
    this.#timer = null;
    this.#logger.info?.('play.tracker.stopped', {});
    return this;
  }

  #schedule() {
    if (!this.#running) return;
    // The callback RETURNS its promise so a tick is awaitable — by a test with
    // fake timers, and by any future shutdown that wants to drain in flight
    // work rather than abandon it mid-probe.
    this.#timer = this.#setTimer(() => this.tick()
      .catch((error) => {
        this.#logger.error?.('play.tracker.tick_failed', { error: error.message });
      })
      .finally(() => this.#schedule()), this.#intervalMs);
  }

  /** One pass over every watched device. Safe to call directly (tests, probes). */
  async tick() {
    await Promise.all(this.#devices.map((device) => this.#trackDevice(device)));
  }

  async #trackDevice({ deviceId, surface }) {
    // A probe still running from the previous tick keeps this one; doubling up
    // would corrupt the CPU delta the inferred source measures across ticks.
    if (this.#inFlight.has(deviceId)) {
      this.#logger.debug?.('play.tracker.tick_skipped_in_flight', { deviceId });
      return;
    }
    this.#inFlight.add(deviceId);
    try {
      const intent = await this.#intent(deviceId);
      const observation = await this.#source.observe(deviceId, {
        expectedContent: intent?.content ?? null,
      });
      await this.#record.execute({
        deviceId,
        surface,
        userId: intent?.userId ?? null,
        grantRef: intent?.grantRef ?? null,
        observation,
      });
      this.#mark(deviceId, { state: observation?.state ?? null, error: null });
    } catch (error) {
      this.#mark(deviceId, { state: null, error: error.message });
      this.#logger.warn?.('play.tracker.device_failed', { deviceId, error: error.message });
    } finally {
      this.#inFlight.delete(deviceId);
    }
  }

  async #intent(deviceId) {
    if (!this.#intents?.findForDevice) return null;
    const intent = await this.#intents.findForDevice(deviceId);
    if (!intent) return null;
    // An expired intent stops attributing. Play is still observed — we simply
    // no longer claim to know whose it is or what it was authorised against.
    if (intent.isExpired(this.#now())) {
      this.#logger.debug?.('play.intent.expired', { deviceId, expiresAt: intent.expiresAt });
      return null;
    }
    return intent;
  }

  #mark(deviceId, { state, error }) {
    const previous = this.#health.get(deviceId) || { consecutiveErrors: 0 };
    this.#health.set(deviceId, {
      lastTickAt: this.#now(),
      lastState: state,
      lastError: error,
      consecutiveErrors: error ? previous.consecutiveErrors + 1 : 0,
    });
  }

  /** Per-device liveness, for the staleness watchdog and for diagnostics. */
  getHealth() {
    return this.#devices.map(({ deviceId }) => ({
      deviceId,
      ...(this.#health.get(deviceId) || { lastTickAt: null, lastState: null, lastError: null, consecutiveErrors: 0 }),
    }));
  }
}

export default PlaySessionTracker;
