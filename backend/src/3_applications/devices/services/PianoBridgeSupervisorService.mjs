/**
 * PianoBridgeSupervisorService — keeps the piano-bridge APK alive from OUTSIDE
 * the tablet, and makes sure a person hears about it when it cannot.
 *
 * Why this exists (2026-09-30): the bridge process on the yellow-room tablet died
 * on 2026-09-27 and stayed dead for two days. The kiosk showed "Piano connection
 * lost", the backend's MIDI-wake client logged 7,950 reconnect warnings, and
 * nothing acted on any of it. Everything that could restart the bridge lived on
 * the tablet itself: START_STICKY, the boot receiver, the APK's own watchdog.
 * None of those survive the app being force-stopped, which also blocks the boot
 * broadcast, so even a reboot did not bring it back.
 *
 * Every `intervalMs` this service reads the bridge's health over the LAN:
 *
 * - **Down** (control plane unreachable for `downConfirmChecks` checks in a row):
 *   relaunch the app through Fully Kiosk (`startApplication`, an explicit launch
 *   that also clears Android's stopped state), backing off between attempts.
 *   If it is still down `alertAfterMs` after it went down, push once.
 * - **One-way** (bridge up, piano powered, echo unverified for `oneWayAlertAfterMs`):
 *   push once. Repair belongs to the APK's own escalation ladder; see
 *   docs/runbooks/piano-kiosk-midi.md.
 * - **Recovered**: log it and, if a person was told about the problem, replace
 *   that card with a quiet "back" card.
 *
 * @module 3_applications/devices/services/PianoBridgeSupervisorService
 */

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_DOWN_CONFIRM_CHECKS = 2;
const DEFAULT_ALERT_AFTER_MS = 5 * 60_000;
const DEFAULT_ONE_WAY_ALERT_AFTER_MS = 10 * 60_000;
const DEFAULT_RELAUNCH_BACKOFF_MS = [60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 30 * 60_000];
const HEARTBEAT_EVERY_TICKS = 20;

export class PianoBridgeSupervisorService {
  #probe; #relaunch; #readPianoPower; #notify; #compose;
  #scheduler; #clock; #logger;
  #deviceId; #location; #timezone;
  #intervalMs; #downConfirmChecks; #alertAfterMs; #oneWayAlertAfterMs; #relaunchBackoffMs;
  #timer = null;
  #ticking = false;
  #ticks = 0;
  // down episode
  #failedChecks = 0;
  #downSince = null;
  #relaunches = 0;
  #nextRelaunchAt = 0;
  #alertedDown = false;
  // one-way episode
  #oneWaySince = null;
  #alertedOneWay = false;

  /**
   * @param {Object} opts
   * @param {import('../ports/IPianoBridgeHealthProbe.mjs').IPianoBridgeHealthProbe} opts.probe
   * @param {() => Promise<{ok:boolean, error?:string}>} opts.relaunch - start the APK via FKB
   * @param {() => Promise<'on'|'off'|'unknown'>} [opts.readPianoPower]
   * @param {(push:{title:string,message:string,data:Object}) => Promise<void>} [opts.notify]
   * @param {(event:Object) => Object|null} opts.compose - push text composer
   * @param {{every:Function}} opts.scheduler
   * @param {string} opts.deviceId
   * @param {string} [opts.location]
   * @param {string} [opts.timezone]
   */
  constructor({
    probe, relaunch, readPianoPower = null, notify = null, compose,
    scheduler, clock = Date, logger = console,
    deviceId, location = null, timezone = null,
    intervalMs = DEFAULT_INTERVAL_MS,
    downConfirmChecks = DEFAULT_DOWN_CONFIRM_CHECKS,
    alertAfterMs = DEFAULT_ALERT_AFTER_MS,
    oneWayAlertAfterMs = DEFAULT_ONE_WAY_ALERT_AFTER_MS,
    relaunchBackoffMs = DEFAULT_RELAUNCH_BACKOFF_MS,
  } = {}) {
    if (typeof probe?.readHealth !== 'function') throw new Error('PianoBridgeSupervisorService requires probe');
    if (typeof relaunch !== 'function') throw new Error('PianoBridgeSupervisorService requires relaunch');
    if (typeof compose !== 'function') throw new Error('PianoBridgeSupervisorService requires compose');
    if (typeof scheduler?.every !== 'function') throw new Error('PianoBridgeSupervisorService requires scheduler');
    if (!deviceId) throw new Error('PianoBridgeSupervisorService requires deviceId');
    this.#probe = probe;
    this.#relaunch = relaunch;
    this.#readPianoPower = readPianoPower;
    this.#notify = notify;
    this.#compose = compose;
    this.#scheduler = scheduler;
    this.#clock = clock;
    this.#logger = logger;
    this.#deviceId = deviceId;
    this.#location = location;
    this.#timezone = timezone;
    this.#intervalMs = intervalMs;
    this.#downConfirmChecks = Math.max(1, downConfirmChecks);
    this.#alertAfterMs = alertAfterMs;
    this.#oneWayAlertAfterMs = oneWayAlertAfterMs;
    this.#relaunchBackoffMs = relaunchBackoffMs.length ? relaunchBackoffMs : DEFAULT_RELAUNCH_BACKOFF_MS;
  }

  start() {
    if (this.#timer) return;
    this.#timer = this.#scheduler.every(this.#intervalMs, () => {
      this.tick().catch((err) => this.#logger.error?.('piano-bridge.supervisor.tick-uncaught', {
        deviceId: this.#deviceId, error: String(err?.message ?? err),
      }));
    });
    this.#logger.info?.('piano-bridge.supervisor.started', {
      deviceId: this.#deviceId,
      intervalMs: this.#intervalMs,
      alertAfterMs: this.#alertAfterMs,
      oneWayAlertAfterMs: this.#oneWayAlertAfterMs,
      canNotify: !!this.#notify,
    });
  }

  stop() {
    this.#timer?.();
    this.#timer = null;
  }

  /** One check. Public so tests (and a future admin "check now") can drive it. */
  async tick() {
    if (this.#ticking) return;
    this.#ticking = true;
    try {
      const health = await this.#probe.readHealth();
      this.#ticks += 1;
      if (health?.reachable) await this.#onReachable(health);
      else await this.#onUnreachable(health);
    } finally {
      this.#ticking = false;
    }
  }

  // ── down ────────────────────────────────────────────────────────────────

  async #onUnreachable(health) {
    const now = this.#clock.now();
    this.#failedChecks += 1;
    if (this.#failedChecks < this.#downConfirmChecks) {
      this.#logger.warn?.('piano-bridge.supervisor.check-failed', {
        deviceId: this.#deviceId, failedChecks: this.#failedChecks, error: health?.error ?? null,
      });
      return;
    }
    if (this.#downSince === null) {
      // The first failed check is when it went quiet, not the confirming one.
      this.#downSince = now - (this.#failedChecks - 1) * this.#intervalMs;
      this.#logger.error?.('piano-bridge.supervisor.down', {
        deviceId: this.#deviceId, error: health?.error ?? null,
        since: new Date(this.#downSince).toISOString(),
      });
    }

    if (now >= this.#nextRelaunchAt) {
      const attempt = this.#relaunches + 1;
      let result;
      try {
        result = await this.#relaunch();
      } catch (err) {
        result = { ok: false, error: String(err?.message ?? err) };
      }
      this.#relaunches = attempt;
      const waitMs = this.#relaunchBackoffMs[Math.min(attempt - 1, this.#relaunchBackoffMs.length - 1)];
      this.#nextRelaunchAt = now + waitMs;
      this.#logger.warn?.('piano-bridge.supervisor.relaunch', {
        deviceId: this.#deviceId, attempt, ok: !!result?.ok, error: result?.error ?? null, nextInMs: waitMs,
      });
    }

    if (!this.#alertedDown && now - this.#downSince >= this.#alertAfterMs) {
      this.#alertedDown = await this.#push('down', { since: new Date(this.#downSince).toISOString() });
    }
  }

  // ── up / one-way ────────────────────────────────────────────────────────

  async #onReachable(health) {
    const now = this.#clock.now();
    this.#failedChecks = 0;
    if (this.#downSince !== null) {
      const downMs = now - this.#downSince;
      this.#logger.info?.('piano-bridge.supervisor.recovered', {
        deviceId: this.#deviceId, downMs, relaunches: this.#relaunches, alerted: this.#alertedDown,
      });
      if (this.#alertedDown) await this.#push('recovered', { downMs });
      this.#downSince = null;
      this.#relaunches = 0;
      this.#nextRelaunchAt = 0;
      this.#alertedDown = false;
    }

    await this.#checkOneWay(health, now);

    if (this.#ticks % HEARTBEAT_EVERY_TICKS === 0) {
      this.#logger.info?.('piano-bridge.supervisor.healthy', {
        deviceId: this.#deviceId, ble: health.ble, outVerified: health.outVerified,
      });
    }
  }

  async #checkOneWay(health, now) {
    if (health.outVerified !== false) {
      if (health.outVerified === true && (this.#oneWaySince !== null || this.#alertedOneWay)) {
        const downMs = this.#oneWaySince === null ? null : now - this.#oneWaySince;
        this.#logger.info?.('piano-bridge.supervisor.one-way-cleared', {
          deviceId: this.#deviceId, downMs, alerted: this.#alertedOneWay,
        });
        if (this.#alertedOneWay) await this.#push('recovered', { downMs });
        this.#oneWaySince = null;
        this.#alertedOneWay = false;
      }
      return;
    }
    // An unanswered echo only means something while the piano is on. A piano
    // that is off never echoes; that is the normal state every night.
    const power = await this.#pianoPower();
    if (power !== 'on') {
      this.#oneWaySince = null;
      return;
    }
    if (this.#oneWaySince === null) {
      this.#oneWaySince = now;
      this.#logger.warn?.('piano-bridge.supervisor.one-way-suspected', { deviceId: this.#deviceId, ble: health.ble });
      return;
    }
    if (!this.#alertedOneWay && now - this.#oneWaySince >= this.#oneWayAlertAfterMs) {
      this.#logger.error?.('piano-bridge.supervisor.one-way', {
        deviceId: this.#deviceId, ble: health.ble, forMs: now - this.#oneWaySince,
      });
      this.#alertedOneWay = await this.#push('one-way', { since: new Date(this.#oneWaySince).toISOString() });
    }
  }

  async #pianoPower() {
    if (!this.#readPianoPower) return 'unknown';
    try {
      return await this.#readPianoPower();
    } catch {
      return 'unknown';
    }
  }

  // ── push ────────────────────────────────────────────────────────────────

  /** @returns {Promise<boolean>} whether a person was told */
  async #push(kind, fields) {
    let push = null;
    try {
      push = this.#compose({
        kind, deviceId: this.#deviceId, location: this.#location, timezone: this.#timezone, ...fields,
      });
    } catch (err) {
      this.#logger.error?.('piano-bridge.supervisor.compose-failed', { kind, error: String(err?.message ?? err) });
    }
    if (!push) return false;
    if (!this.#notify) {
      this.#logger.error?.('piano-bridge.supervisor.alert-unsent', {
        deviceId: this.#deviceId, kind, reason: 'no notify_service configured',
      });
      return false;
    }
    try {
      await this.#notify(push);
      this.#logger.info?.('piano-bridge.supervisor.alert-sent', { deviceId: this.#deviceId, kind });
      return true;
    } catch (err) {
      this.#logger.error?.('piano-bridge.supervisor.alert-failed', {
        deviceId: this.#deviceId, kind, error: String(err?.message ?? err),
      });
      return false;
    }
  }
}

export default PianoBridgeSupervisorService;
