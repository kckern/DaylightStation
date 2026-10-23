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
 *   __docs/runbooks/piano-kiosk-midi.md.
 * - **Speaker** (bridge up, piano on, A2DP speaker disconnected): climb the
 *   PianoSpeakerRecoveryPolicy ladder — A2DP reconnect, tablet Bluetooth off/on,
 *   plug power-cycle — silently, then push once and flag the kiosk banner.
 * - **Recovered**: log it and, if a person was told about the problem, replace
 *   that card with a quiet "back" card.
 *
 * @module 3_applications/devices/services/PianoBridgeSupervisorService
 */

import {
  initialSpeakerEpisode, decideSpeaker, forceGiveUp, speakerPublicState,
} from './PianoSpeakerRecoveryPolicy.mjs';

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_DOWN_CONFIRM_CHECKS = 2;
const DEFAULT_ALERT_AFTER_MS = 5 * 60_000;
const DEFAULT_ONE_WAY_ALERT_AFTER_MS = 10 * 60_000;
const DEFAULT_RELAUNCH_BACKOFF_MS = [60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 30 * 60_000];
const HEARTBEAT_EVERY_TICKS = 20;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const WEEKLY_WEEKDAY = 'Sun';
const WEEKLY_HOUR = 18;
const DEFAULT_LOG_MODULE = 'piano-bridge-supervisor';
const READY_CONFIRM_MS = 10 * 60_000;

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
  // speaker episode
  #speaker = null;
  #speakerEpisode = initialSpeakerEpisode();
  #speakerAnnounced = false;  // first tick publishes, clearing a banner from before a restart
  #speakerAlert = null;       // {kind, fields} still owed to a person
  #speakerAlertTried = false;
  #speakerTold = false;       // a push actually went out (not merely attempted)
  // readiness: can the ladder actually work if the speaker drops?
  #readyNextAt = 0;
  #readyAlertedAt = null;
  #readySuspected = false;    // one sighting is a suspicion; two in a row is a problem
  #readyNotifyLessAt = null;  // with no push target, say so once a day
  #logModule = DEFAULT_LOG_MODULE;
  // weekly summary (state lives in the log store, so a deploy cannot repeat or lose it)
  #weeklyNextAt = 0;
  #weeklyDoneDate = null;

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
    speaker = null,
    logModule = DEFAULT_LOG_MODULE,
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
    this.#speaker = speaker;
    this.#logModule = logModule;
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
      speakerRecovery: !!this.#speaker,
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
      if (this.#speaker) {
        await this.#checkSpeaker(health);
        await this.#checkReadiness();
        await this.#checkWeekly();
      }
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

  // ── speaker ─────────────────────────────────────────────────────────────

  async #checkSpeaker(health) {
    const now = this.#clock.now();
    const bridgeUp = !!health?.reachable;
    const speaker = typeof health?.speaker === 'boolean' ? health.speaker : null;
    // Power only matters while the speaker is down; skip the HA read otherwise.
    const pianoPower = bridgeUp && speaker === false ? await this.#pianoPower() : 'unknown';
    const before = speakerPublicState(this.#speakerEpisode);
    const { episode, action } = decideSpeaker(
      this.#speakerEpisode,
      { speaker, pianoPower, bridgeUp },
      now,
      { ...(this.#speaker.policy ?? {}), plugAvailable: !!this.#speaker.plugCycle },
    );
    this.#speakerEpisode = episode;
    await this.#onSpeakerAction(action, now);
    const after = speakerPublicState(this.#speakerEpisode);
    await this.#deliverSpeakerAlert();
    if (after !== before || after === 'needs-help' || !this.#speakerAnnounced) {
      this.#speakerAnnounced = true;
      this.#publishSpeaker(this.#speakerPublic());
    }
  }

  #speakerPublic() {
    return speakerPublicState(this.#speakerEpisode);
  }

  /** Owed alerts retry every tick until HA accepts one; with no notify target, say so once. */
  async #deliverSpeakerAlert() {
    if (!this.#speakerAlert || this.#speakerTold) return;
    if (this.#speakerAlertTried && !this.#notify) return;
    this.#speakerAlertTried = true;
    this.#speakerTold = await this.#push(this.#speakerAlert.kind, this.#speakerAlert.fields, this.#speaker.compose);
  }

  async #onSpeakerAction(action, now) {
    const deviceId = this.#deviceId;
    if (action.type === 'attempt') {
      if (action.opened) this.#logger.warn?.('piano.speaker.dropped', { deviceId });
      for (const s of action.skipped) this.#logger.info?.('piano.speaker.rung-skipped', { deviceId, ...s });
      const { step } = action;
      this.#logger.info?.('piano.speaker.attempt', {
        deviceId, rung: step.rung, action: step.action, settleMs: step.settleMs ?? null, offMs: step.offMs ?? null,
      });
      let result;
      try {
        if (step.action === 'a2dpReconnect') result = await this.#speaker.actions.a2dpReconnect();
        else if (step.action === 'btCycle') result = await this.#speaker.actions.bluetoothCycle(step.settleMs);
        else {
          // Pin the screen for the whole outage so the power-sync authority neither
          // blanks it at 15 s of "piano off" nor pulses it on the power edge.
          try { await this.#speaker.holdScreen?.(step.offMs + step.checkAfterMs); } catch (err) {
            this.#logger.warn?.('piano.speaker.screen-hold-failed', { deviceId, error: String(err?.message ?? err) });
          }
          result = await this.#speaker.plugCycle(step.offMs);
        }
      } catch (err) {
        result = { ok: false, error: String(err?.message ?? err) };
      }
      if (!result?.ok) {
        this.#logger.warn?.('piano.speaker.attempt-failed', {
          deviceId, rung: step.rung, action: step.action, error: result?.error ?? null,
        });
      }
      if (result?.unpowered) {
        this.#speakerEpisode = forceGiveUp(this.#speakerEpisode, now, 'piano-unpowered').episode;
        this.#logger.error?.('piano.speaker.gave-up', { deviceId, reason: 'piano-unpowered', error: result.error ?? null });
        this.#owe('unpowered', {});
      }
      return;
    }
    if (action.type === 'recovered') {
      this.#logger.info?.('piano.speaker.recovered', { deviceId, rung: action.rung, durationMs: action.durationMs, alerted: !!action.alerted });
      // A "back" card only replaces an alarm somebody actually received.
      if (this.#speakerTold) await this.#push('back', { downMs: action.durationMs }, this.#speaker.compose);
      this.#speakerAlert = null;
      this.#speakerAlertTried = false;
      this.#speakerTold = false;
      return;
    }
    if (action.type === 'ended') {
      this.#logger.info?.('piano.speaker.ended', { deviceId, rung: action.rung, reason: 'piano-off' });
      return;
    }
    if (action.type === 'gave-up') {
      this.#logger.error?.('piano.speaker.gave-up', { deviceId, reason: action.reason, skipped: action.skipped });
      if (action.notify) this.#owe('needs-help', { reason: action.reason, skipped: action.skipped });
    }
  }

  #owe(kind, fields) {
    this.#speakerAlert = { kind, fields };
    this.#speakerAlertTried = false;
    this.#speakerTold = false;
  }

  #publishSpeaker(state) {
    if (!this.#speaker.publish) return;
    try {
      this.#speaker.publish({
        topic: 'piano.speaker', deviceId: this.#deviceId, state, rung: this.#speakerEpisode.rung,
        told: this.#speakerTold,
      });
    } catch (err) {
      this.#logger.warn?.('piano.speaker.publish-failed', { deviceId: this.#deviceId, error: String(err?.message ?? err) });
    }
  }

  // ── readiness ───────────────────────────────────────────────────────────

  async #checkReadiness() {
    const check = this.#speaker.checkReady;
    const now = this.#clock.now();
    if (typeof check !== 'function' || now < this.#readyNextAt) return;
    const deviceId = this.#deviceId;
    let problems;
    try {
      problems = [...(await check())];
    } catch (err) {
      this.#logger.warn?.('piano.speaker.ready-check-failed', { deviceId, error: String(err?.message ?? err) });
      this.#readyNextAt = now + HOUR_MS;
      return;
    }

    if (!problems.length) {
      this.#readySuspected = false;
      if (!this.#notify) {
        // Nobody can be told anything; say so at warn, once a day — not an error every hour.
        if (this.#readyNotifyLessAt === null || now - this.#readyNotifyLessAt >= DAY_MS) {
          this.#logger.warn?.('piano.speaker.not-ready', { deviceId, problems: ['no-notify-target'] });
          this.#readyNotifyLessAt = now;
        }
        this.#readyNextAt = now + DAY_MS;
        return;
      }
      this.#logger.info?.('piano.speaker.ready', { deviceId });
      if (this.#readyAlertedAt !== null) {
        await this.#push('ready-again', {}, this.#speaker.compose);
        this.#readyAlertedAt = null;
      }
      this.#readyNextAt = now + DAY_MS;
      return;
    }

    // HA restarting reads as "plug unavailable" for a minute: re-check before alarming.
    if (!this.#readySuspected) {
      this.#readySuspected = true;
      this.#logger.info?.('piano.speaker.not-ready-suspected', { deviceId, problems });
      this.#readyNextAt = now + READY_CONFIRM_MS;
      return;
    }
    if (!this.#notify) problems.push('no-notify-target');
    this.#logger.warn?.('piano.speaker.not-ready', { deviceId, problems });
    this.#readyNextAt = now + HOUR_MS; // a fix clears within the hour
    if (!this.#notify) return;
    if (this.#readyAlertedAt !== null && now - this.#readyAlertedAt < DAY_MS) return;
    if (await this.#alertedInLast24h('not-ready')) { this.#readyAlertedAt = now; return; }
    if (await this.#push('not-ready', { problems }, this.#speaker.compose)) this.#readyAlertedAt = now;
  }

  /** The daily budget survives restarts: ask the log store whether this alert already went out. */
  async #alertedInLast24h(kind) {
    const query = this.#speaker.queryLogs;
    if (typeof query !== 'function') return false;
    try {
      const rows = await query(`"piano-bridge.supervisor.alert-sent" AND data.kind:"${kind}" AND _time:24h AND ${this.#logScope()}`);
      return rows.length > 0;
    } catch {
      return false; // can't tell: one extra push beats a silent broken ladder
    }
  }

  #logScope() {
    return `context.module:"${this.#logModule}" AND data.deviceId:"${this.#deviceId}"`;
  }

  // ── weekly summary ──────────────────────────────────────────────────────

  async #checkWeekly() {
    const query = this.#speaker.queryLogs;
    const now = this.#clock.now();
    if (typeof query !== 'function' || now < this.#weeklyNextAt) return;
    const local = localParts(now, this.#timezone);
    if (local.weekday !== WEEKLY_WEEKDAY || local.hour < WEEKLY_HOUR || this.#weeklyDoneDate === local.date) return;
    const deviceId = this.#deviceId;
    const scope = this.#logScope();
    try {
      // The marker is visible only after the sink's ~5 s flush; a restart inside that
      // window can repeat the summary. Narrow enough to accept.
      const prior = await query(`"piano.speaker.weekly-summary" AND _time:6d AND ${scope}`);
      if (prior.length) { this.#weeklyDoneDate = local.date; return; }
      const rows = await query(`("piano.speaker.dropped" OR "piano.speaker.recovered" OR "piano.speaker.gave-up") AND _time:7d AND ${scope}`);
      let drops = 0; let gaveUp = 0; const byRung = {};
      for (const r of rows) {
        if (r._msg === 'piano.speaker.dropped') drops += 1;
        else if (r._msg === 'piano.speaker.gave-up') gaveUp += 1;
        else if (r._msg === 'piano.speaker.recovered') {
          // A recovery after a give-up was a person's doing, already counted as gave-up.
          if (r['data.alerted'] === 'true' || r['data.alerted'] === true) continue;
          const rung = Number(r['data.rung']);
          if (Number.isInteger(rung) && rung > 0) byRung[rung] = (byRung[rung] ?? 0) + 1;
        }
      }
      this.#logger.info?.('piano.speaker.weekly-summary', { deviceId, drops, byRung, gaveUp });
      if (drops > 0 || gaveUp > 0) await this.#push('weekly', { drops, byRung, gaveUp }, this.#speaker.compose);
      this.#weeklyDoneDate = local.date;
    } catch (err) {
      this.#logger.warn?.('piano.speaker.weekly-failed', { deviceId, error: String(err?.message ?? err) });
      this.#weeklyNextAt = now + HOUR_MS;
    }
  }

  // ── push ────────────────────────────────────────────────────────────────

  /** @returns {Promise<boolean>} whether a person was told */
  async #push(kind, fields, compose = this.#compose) {
    let push = null;
    try {
      push = compose({
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
      const res = await this.#notify(push);
      // HomeAssistantAdapter.callService resolves {ok:false} rather than throwing.
      if (res && res.ok === false) throw new Error(res.error || 'notify refused');
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

/** Weekday / hour / date in the household zone (the tablet's clock is not the house's). */
function localParts(ms, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || undefined, weekday: 'short', hour: 'numeric', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { weekday: parts.weekday, hour: Number(parts.hour), date: `${parts.year}-${parts.month}-${parts.day}` };
}

export default PianoBridgeSupervisorService;
