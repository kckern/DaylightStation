/**
 * PianoScreenAuthorityService — reconciles the yellow-room piano tablet's FKB
 * backlight to the piano's real power, making DS the single writer for the OFF
 * side of that screen.
 *
 * The one invariant this service continuously enforces (see
 * docs/_wip/plans/2026-07-01-piano-tablet-screen-power-sync.md):
 *
 *     piano OFF           ⇒  screen OFF   (continuous — reconciled)
 *     piano OFF→ON edge   ⇒  pulse screen ON   (the "flip the piano on" wake)
 *
 * While the piano is ON the browser screensaver owns the screen's on/off state,
 * so DS never force-ONs continuously — that's what lets a manual-off stick with
 * no override flag. DS only:
 *   - force-OFFs when the piano has read OFF continuously for `offDebounceMs`
 *     (a debounce, NOT a delay — a re-ON within the window cancels it, which is
 *     the transient 0 W metering-dip protection), and
 *   - pulses ON exactly once on a confirmed OFF→ON power edge.
 *
 * Fail-safe: if the piano power is unknown / HA is unreachable, treat it as ON
 * (leave the tablet usable) — never screenOff, and cancel any pending off.
 *
 * Coordination: this device is NOT presence-managed (only office-tv declares a
 * `presence:` block), and ScreenPresenceService actuates HA input_booleans, a
 * different concern from the FKB backlight. There is no two-writer conflict — this
 * service is the sole continuous writer of the yellow-room-tablet FKB screen.
 *
 * @module 3_applications/devices/services/PianoScreenAuthorityService
 */

const DEFAULT_POLL_MS = 3000;
const DEFAULT_OFF_DEBOUNCE_MS = 15000;
const DEFAULT_RECONCILE_MS = 45000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_BASE_MS = 250;

export class PianoScreenAuthorityService {
  #ha; #deviceService; #logger; #clock;
  #deviceId; #pianoPowerEntity;
  #pollMs; #offDebounceMs; #reconcileMs; #maxRetries; #backoffBaseMs;
  #notifyService; #sleep;

  #pollTimer; #reconcileTimer;

  // `committedPower` is the DEBOUNCED power state DS acts on: ∈ 'on' | 'off' | null.
  // It only becomes 'off' after the debounce fires — so a transient dip (which
  // never commits) can't be mistaken for a real power cycle on the next ON read.
  #committedPower;
  // Timestamp of the current continuous-off run, or null when not armed.
  #offArmedAt;

  /**
   * @param {Object} opts
   * @param {{getState:Function, callService:Function}} opts.haGateway
   * @param {{get:Function}} opts.deviceService
   * @param {string} opts.deviceId - FKB tablet device id (e.g. 'yellow-room-tablet')
   * @param {string} opts.pianoPowerEntity - HA binary_sensor for piano power
   * @param {Object} [opts.logger]
   * @param {{now:()=>number}} [opts.clock]
   * @param {number} [opts.pollIntervalMs]
   * @param {number} [opts.offDebounceMs]
   * @param {number} [opts.reconcileIntervalMs]
   * @param {number} [opts.maxRetries]
   * @param {number} [opts.backoffBaseMs]
   * @param {string} [opts.notifyService] - HA notify service for give-up escalation
   * @param {(ms:number)=>Promise<void>} [opts.sleep] - injectable for tests
   */
  constructor({
    haGateway, deviceService, logger = console, clock = Date,
    deviceId, pianoPowerEntity,
    pollIntervalMs = DEFAULT_POLL_MS,
    offDebounceMs = DEFAULT_OFF_DEBOUNCE_MS,
    reconcileIntervalMs = DEFAULT_RECONCILE_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    backoffBaseMs = DEFAULT_BACKOFF_BASE_MS,
    notifyService = null,
    sleep,
  } = {}) {
    if (!haGateway || typeof haGateway.getState !== 'function') {
      throw new Error('PianoScreenAuthorityService requires haGateway with getState');
    }
    if (!deviceService || typeof deviceService.get !== 'function') {
      throw new Error('PianoScreenAuthorityService requires deviceService with get');
    }
    if (!deviceId) throw new Error('PianoScreenAuthorityService requires deviceId');
    if (!pianoPowerEntity) throw new Error('PianoScreenAuthorityService requires pianoPowerEntity');

    this.#ha = haGateway;
    this.#deviceService = deviceService;
    this.#logger = logger;
    this.#clock = clock;
    this.#deviceId = deviceId;
    this.#pianoPowerEntity = pianoPowerEntity;
    this.#pollMs = pollIntervalMs;
    this.#offDebounceMs = offDebounceMs;
    this.#reconcileMs = reconcileIntervalMs;
    this.#maxRetries = maxRetries;
    this.#backoffBaseMs = backoffBaseMs;
    this.#notifyService = notifyService;
    this.#sleep = typeof sleep === 'function'
      ? sleep
      : (ms) => new Promise((r) => setTimeout(r, ms));

    this.#pollTimer = null;
    this.#reconcileTimer = null;
    this.#committedPower = null;
    this.#offArmedAt = null;
  }

  start() {
    // A throw out of a timer tick would kill the interval — every tick is fully
    // wrapped, plus a belt-and-suspenders .catch on the async body.
    this.#pollTimer = setInterval(() => {
      this.#tickPoll().catch((err) => this.#logger.error?.('piano-screen-authority.poll.uncaught', {
        error: String(err?.message ?? err),
      }));
    }, this.#pollMs);
    this.#reconcileTimer = setInterval(() => {
      this.#tickReconcile().catch((err) => this.#logger.error?.('piano-screen-authority.reconcile.uncaught', {
        error: String(err?.message ?? err),
      }));
    }, this.#reconcileMs);
    this.#pollTimer.unref?.();
    this.#reconcileTimer.unref?.();
    this.#logger.info?.('piano-screen-authority.started', {
      deviceId: this.#deviceId,
      entity: this.#pianoPowerEntity,
      pollMs: this.#pollMs,
      offDebounceMs: this.#offDebounceMs,
      reconcileMs: this.#reconcileMs,
    });
  }

  stop() {
    if (this.#pollTimer) clearInterval(this.#pollTimer);
    if (this.#reconcileTimer) clearInterval(this.#reconcileTimer);
    this.#pollTimer = null;
    this.#reconcileTimer = null;
  }

  /**
   * Poll tick: read piano power, drive edges + the continuous-off debounce.
   * Wrapped so a throw never escapes into the interval machinery.
   * @private
   */
  async #tickPoll() {
    try {
      const now = this.#clock.now();
      const reading = await this.#readPower();

      if (reading === 'on') {
        const wasConfirmedOff = this.#committedPower === 'off';
        // Any ON read cancels a pending (un-fired) off-debounce — the transient
        // 0 W dip protection: on→off→on within the window never commits to off.
        this.#offArmedAt = null;
        this.#committedPower = 'on';
        if (wasConfirmedOff) {
          // Real OFF→ON power edge → pulse the screen on (the "flip the piano on" wake).
          this.#logger.info?.('piano-screen-authority.edge.off-to-on', { deviceId: this.#deviceId });
          await this.#applyScreen(true, 'off-to-on-edge');
        }
        return;
      }

      if (reading === 'off') {
        if (this.#offArmedAt === null) {
          // Off-edge — arm the continuous-off timer; do NOT act yet.
          this.#offArmedAt = now;
          this.#logger.debug?.('piano-screen-authority.debounce.arm', {
            deviceId: this.#deviceId, offDebounceMs: this.#offDebounceMs,
          });
          return;
        }
        // Continuous-off: commit + force off only after OFF has held for the full window.
        if (this.#committedPower !== 'off' && now - this.#offArmedAt >= this.#offDebounceMs) {
          this.#committedPower = 'off';
          this.#logger.debug?.('piano-screen-authority.debounce.fire', {
            deviceId: this.#deviceId, continuousOffMs: now - this.#offArmedAt,
          });
          await this.#applyScreen(false, 'continuous-off');
        }
        return;
      }

      // reading === 'unknown' → fail-safe ON: never screenOff; cancel any pending off.
      // committedPower is intentionally left unchanged so a later real ON still
      // reads as an edge if the piano was confirmed off before the sensor dropped.
      if (this.#offArmedAt !== null) {
        this.#logger.debug?.('piano-screen-authority.failsafe.cancel-pending-off', { deviceId: this.#deviceId });
        this.#offArmedAt = null;
      }
    } catch (err) {
      this.#logger.error?.('piano-screen-authority.poll.error', {
        deviceId: this.#deviceId, error: String(err?.message ?? err),
      });
    }
  }

  /**
   * Reconcile tick: while the piano is confirmed OFF, re-assert screen OFF if the
   * real panel has drifted ON. Never force-ON here — the browser owns on-state.
   * @private
   */
  async #tickReconcile() {
    try {
      if (this.#committedPower !== 'off') return; // only enforce the OFF invariant
      const device = this.#deviceService.get(this.#deviceId);
      if (!device) {
        this.#logger.warn?.('piano-screen-authority.reconcile.no-device', { deviceId: this.#deviceId });
        return;
      }
      const status = await device.getStatus();
      if (status?.screenOn === true) {
        this.#logger.info?.('piano-screen-authority.reconcile.correct-off', { deviceId: this.#deviceId });
        await this.#applyScreen(false, 'reconcile');
      }
    } catch (err) {
      this.#logger.error?.('piano-screen-authority.reconcile.error', {
        deviceId: this.#deviceId, error: String(err?.message ?? err),
      });
    }
  }

  /** @private @returns {Promise<'on'|'off'|'unknown'>} */
  async #readPower() {
    try {
      const res = await this.#ha.getState(this.#pianoPowerEntity);
      const state = res && typeof res.state === 'string' ? res.state : null;
      if (state === 'on') return 'on';
      if (state === 'off') return 'off';
      return 'unknown';
    } catch (err) {
      this.#logger.debug?.('piano-screen-authority.read.failsafe-on', {
        deviceId: this.#deviceId, error: String(err?.message ?? err),
      });
      return 'unknown';
    }
  }

  /**
   * Set the screen to `desiredOn`, then VERIFY against the device's real screen
   * state (defeats FKB's 200/login silent-success). On mismatch: retry with
   * backoff up to maxRetries; still wrong AND desiredOn → loadStartUrl revive +
   * one retry; still wrong → log error + notify. Idempotent.
   * @private
   */
  async #applyScreen(desiredOn, reason) {
    const device = this.#deviceService.get(this.#deviceId);
    if (!device) {
      this.#logger.warn?.('piano-screen-authority.apply.no-device', { deviceId: this.#deviceId, desiredOn });
      return false;
    }

    for (let attempt = 0; attempt <= this.#maxRetries; attempt++) {
      if (attempt > 0) {
        this.#logger.warn?.('piano-screen-authority.verify.retry', { deviceId: this.#deviceId, desiredOn, attempt, reason });
        await this.#sleep(this.#backoffBaseMs * attempt);
      }
      await device.setScreen(desiredOn);
      if (await this.#verify(device, desiredOn)) {
        if (attempt > 0) {
          this.#logger.info?.('piano-screen-authority.verify.recovered', { deviceId: this.#deviceId, desiredOn, attempt });
        }
        return true;
      }
      this.#logger.warn?.('piano-screen-authority.verify.mismatch', { deviceId: this.#deviceId, desiredOn, attempt, reason });
    }

    // Exhausted retries. For a wake (desiredOn), the WebView may be dead — revive
    // it via loadStartUrl then try once more.
    if (desiredOn) {
      this.#logger.warn?.('piano-screen-authority.escalate.load-start-url', { deviceId: this.#deviceId, reason });
      try {
        await device.clearContent(); // loadStartUrl — revive a dead kiosk page
        await device.setScreen(true);
        if (await this.#verify(device, true)) {
          this.#logger.info?.('piano-screen-authority.escalate.recovered', { deviceId: this.#deviceId });
          return true;
        }
      } catch (err) {
        this.#logger.warn?.('piano-screen-authority.escalate.error', {
          deviceId: this.#deviceId, error: String(err?.message ?? err),
        });
      }
    }

    this.#logger.error?.('piano-screen-authority.give-up', {
      deviceId: this.#deviceId, desiredOn, reason, maxRetries: this.#maxRetries,
    });
    await this.#notify(desiredOn);
    return false;
  }

  /** @private */
  async #verify(device, desiredOn) {
    try {
      const status = await device.getStatus();
      return status?.screenOn === desiredOn;
    } catch (err) {
      this.#logger.warn?.('piano-screen-authority.verify.status-error', {
        deviceId: this.#deviceId, error: String(err?.message ?? err),
      });
      return false;
    }
  }

  /** @private */
  async #notify(desiredOn) {
    if (!this.#notifyService || typeof this.#ha?.callService !== 'function') return;
    try {
      await this.#ha.callService('notify', this.#notifyService, {
        title: 'Piano tablet screen out of sync',
        message: `Failed to set the piano tablet screen ${desiredOn ? 'ON' : 'OFF'} after ${this.#maxRetries} retries`,
      });
      this.#logger.info?.('piano-screen-authority.notify.sent', {
        deviceId: this.#deviceId, notifyService: this.#notifyService,
      });
    } catch (err) {
      this.#logger.error?.('piano-screen-authority.notify.failed', {
        deviceId: this.#deviceId, error: String(err?.message ?? err),
      });
    }
  }
}

export default PianoScreenAuthorityService;
