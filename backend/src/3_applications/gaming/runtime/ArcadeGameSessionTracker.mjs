/**
 * Drives observation of every play surface that must be watched from outside.
 *
 * Surfaces that report their own lifecycle do not appear here — they push
 * straight into `RecordArcadeGameObservation`. This runtime exists only for surfaces
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
 * Timing goes through `IApplicationScheduler` and the clock is injected: this
 * layer owns no globals.
 */
export class ArcadeGameSessionTracker {
  #devices; #source; #intents; #record; #nameUnidentified; #intervalMs;
  #scheduler; #now; #logger; #controllersFor;
  #cancel = null; #running = false;
  #inFlight = new Set();
  #health = new Map();

  constructor({
    devices = [], observationSource, intents, recordObservation,
    nameUnidentified = null,
    controllersFor = null,
    intervalMs, scheduler, now, logger = console,
  }) {
    if (!observationSource?.observe) throw new Error('ArcadeGameSessionTracker requires an observationSource');
    if (!recordObservation?.execute) throw new Error('ArcadeGameSessionTracker requires recordObservation');
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('ArcadeGameSessionTracker requires a positive intervalMs');
    if (typeof scheduler?.after !== 'function') {
      throw new Error('ArcadeGameSessionTracker requires an injected scheduler with after()');
    }
    if (typeof now !== 'function') throw new Error('ArcadeGameSessionTracker requires an injected now()');
    this.#devices = devices;
    this.#source = observationSource;
    this.#intents = intents || null;
    this.#record = recordObservation;
    this.#nameUnidentified = nameUnidentified;
    this.#controllersFor = typeof controllersFor === 'function' ? controllersFor : null;
    this.#intervalMs = intervalMs;
    this.#scheduler = scheduler;
    this.#now = now;
    this.#logger = logger;
  }

  get isRunning() { return this.#running; }

  start() {
    if (this.#running) return this;
    this.#running = true;
    this.#logger.info?.('arcade.tracker.started', {
      devices: this.#devices.map((d) => d.deviceId), intervalMs: this.#intervalMs,
    });
    this.#schedule();
    return this;
  }

  stop() {
    this.#running = false;
    this.#cancel?.();
    this.#cancel = null;
    this.#logger.info?.('arcade.tracker.stopped', {});
    return this;
  }

  #schedule() {
    if (!this.#running) return;
    // The callback RETURNS its promise so a tick is awaitable — by a test with
    // a fake scheduler, and by any future shutdown that wants to drain in-flight
    // work rather than abandon it mid-probe.
    this.#cancel = this.#scheduler.after(this.#intervalMs, () => this.tick()
      .catch((error) => {
        this.#logger.error?.('arcade.tracker.tick_failed', { error: error.message });
      })
      .finally(() => this.#schedule()));
  }

  /** One pass over every watched device. Safe to call directly (tests, probes). */
  async tick() {
    await Promise.all(this.#devices.map((device) => this.#trackDevice(device)));
  }

  async #trackDevice({ deviceId, surface }) {
    // A probe still running from the previous tick keeps this one; doubling up
    // would corrupt the CPU delta the inferred source measures across ticks.
    if (this.#inFlight.has(deviceId)) {
      this.#logger.debug?.('arcade.tracker.tick_skipped_in_flight', { deviceId });
      return;
    }
    this.#inFlight.add(deviceId);
    try {
      const intent = await this.#intent(deviceId);
      let observation = await this.#source.observe(deviceId, {
        expectedContent: intent?.content ?? null,
      });
      if (this.#controllersFor && observation?.loaded === true) {
        try {
          const controllers = await this.#controllersFor(deviceId);
          if (Number.isFinite(controllers)) observation = { ...observation, controllers };
        } catch (error) {
          this.#logger.debug?.('arcade.controllers.observe_failed', { deviceId, error: error.message });
        }
      }
      const result = await this.#record.execute({
        deviceId,
        surface,
        userId: intent?.userId ?? null,
        grantRef: intent?.grantRef ?? null,
        observation,
      });

      // A game started at the device itself — which is how the arcade is
      // actually used — opens a session nobody named. The device's own logs know
      // what it was, so ask them once and fill the blank in. Only ever attempted
      // for a session that is genuinely unidentified, so this costs nothing on
      // the normal path.
      if (this.#nameUnidentified && result?.session && !result.session.content?.contentId) {
        try {
          await this.#nameUnidentified(result.session);
        } catch (error) {
          this.#logger.warn?.('arcade.session.naming_failed', { deviceId, error: error.message });
        }
      }
      this.#mark(deviceId, {
        state: observation?.state ?? null,
        degraded: observation?.degraded === true,
        error: null,
        unrecordable: observation?.state === 'playing'
          && observation?.loaded === true
          && !result?.session,
        observation,
      });
    } catch (error) {
      this.#mark(deviceId, { state: null, degraded: false, error: error.message });
      this.#logger.warn?.('arcade.tracker.device_failed', { deviceId, error: error.message });
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
      this.#logger.debug?.('arcade.intent.expired', { deviceId, expiresAt: intent.expiresAt });
      return null;
    }
    return intent;
  }

  #mark(deviceId, { state, degraded, error, unrecordable = false, observation = null }) {
    const previous = this.#health.get(deviceId) || {
      consecutiveErrors: 0, consecutiveUnrecordable: 0, observationSignature: null,
    };
    const consecutiveUnrecordable = error
      ? previous.consecutiveUnrecordable
      : (unrecordable ? previous.consecutiveUnrecordable + 1 : 0);
    const isUnrecordable = consecutiveUnrecordable >= 2;
    const observationSignature = observation ? JSON.stringify({
      state: observation.state ?? null,
      loaded: observation.loaded ?? null,
      loadId: observation.loadId ?? null,
      contentId: observation.content?.contentId ?? null,
    }) : previous.observationSignature;
    const next = {
      lastTickAt: this.#now(),
      lastState: state,
      // True when the observation reached us but could not confirm
      // playing-versus-paused — a measurably worse meter, not a failure.
      degraded: degraded === true || isUnrecordable,
      lastError: error,
      consecutiveErrors: error ? previous.consecutiveErrors + 1 : 0,
      consecutiveUnrecordable,
      unrecordable: isUnrecordable,
      observationSignature,
    };
    this.#health.set(deviceId, next);

    if (observation && observationSignature !== previous.observationSignature) {
      this.#logger.info?.('arcade.observe.transition', {
        deviceId,
        state: observation.state ?? null,
        loaded: observation.loaded ?? null,
        loadId: observation.loadId ?? null,
        contentId: observation.content?.contentId ?? null,
        channel: observation.channel ?? null,
      });
    }
    if (isUnrecordable && !previous.unrecordable) {
      this.#logger.warn?.('arcade.session.unrecordable', {
        deviceId, consecutiveObservations: consecutiveUnrecordable,
      });
    } else if (!isUnrecordable && previous.unrecordable) {
      this.#logger.info?.('arcade.session.unrecordable_cleared', { deviceId });
    }
  }

  /** Per-device liveness, for the staleness watchdog and for diagnostics. */
  getHealth() {
    return this.#devices.map(({ deviceId }) => {
      const { observationSignature: _internalSignature, ...health } = this.#health.get(deviceId) || {
        lastTickAt: null, lastState: null, degraded: false, lastError: null,
        consecutiveErrors: 0, consecutiveUnrecordable: 0, unrecordable: false,
      };
      return { deviceId, ...health };
    });
  }
}

export default ArcadeGameSessionTracker;
