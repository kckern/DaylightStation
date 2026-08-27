/**
 * Orchestrates the game-time budget (design D1–D6, D15–D16). The server is the
 * source of truth (D3): the kiosk reloads many times a day, so open returns
 * the recorded cumulative for the client to seed from, and settles are
 * idempotent high-water totals the domain math enforces.
 *
 * Config is read PER CALL, never snapshotted at construction — a household
 * config edit must take effect on the very next request, with no service
 * reconstruction and no restart.
 */
import {
  budgetStudyDate, applyOpen, applySettle, applyClose, balanceFor,
} from '#domains/piano/gameBudget.mjs';

const STALE_AFTER_SECONDS = 900; // 15 min: past this, a crashed session is sealed, not resumed.

// The unmetered shapes returned when the feature is off OR the household
// config is broken (fail-open posture — see the two config-invalid catches
// below). Kept as named constants so open/settle/close/balance all agree on
// exactly what "unmetered" looks like to a caller.
const ENABLED_FALSE = { enabled: false };
const DISABLED_SETTLE = { secondsLeft: Infinity, depleted: false, deviceDepleted: false };
const OK_CLOSE = { ok: true }; // close's happy-path shape and its fail-open shape are identical.

export class PianoGameBudgetService {
  #store; #config; #timezone; #clock; #idFactory; #logger;

  constructor({
    store, config, timezone = null, clock = () => new Date(),
    idFactory = () => `gbs_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    logger = console,
  } = {}) {
    if (!store) throw new Error('PianoGameBudgetService requires store');
    if (typeof config !== 'function') throw new Error('PianoGameBudgetService requires a config accessor');
    this.#store = store; this.#config = config; this.#timezone = timezone;
    this.#clock = clock; this.#idFactory = idFactory; this.#logger = logger;
  }

  #cfg() { return this.#config() ?? {}; }

  #warnAtSeconds(cfg) { return (cfg.warnAtMinutes ?? 5) * 60; }

  /**
   * `budgetStudyDate` throws when the timezone is missing/blank (Task 1's
   * D6 hardening — a UTC fallback would reset allowances mid-afternoon).
   * That's a household misconfiguration, not a caller bug, so it is caught
   * HERE at the single call site every public method routes through, rather
   * than at each individual call site. Returns `null` on failure; callers
   * must treat `null` as "bail out fail-open", not "proceed with an empty
   * date" — the null itself carries no day.
   */
  #tryToday(context) {
    try {
      return budgetStudyDate(this.#clock(), this.#timezone);
    } catch (err) {
      this.#logger.error?.('budget.config-invalid', { key: 'timezone', error: err?.message, ...context });
      return null;
    }
  }

  /**
   * `balanceFor` throws when dailyMinutes/deviceDailyMinutes is missing or
   * not a positive finite number (Task 1's hardening — `undefined * 60` was
   * NaN, and `NaN <= 0` is false, so a yaml typo silently granted unlimited
   * play). Same fail-open contract as `#tryToday`: null on failure, and the
   * error message already names the offending key (`config.<key>`), which we
   * pull out so the log line is greppable without parsing prose.
   */
  #tryBalance(day, cfg, learnerId, context) {
    try {
      return balanceFor(day, cfg, learnerId);
    } catch (err) {
      const key = /config\.(\w+)/.exec(err?.message ?? '')?.[1] ?? 'dailyMinutes/deviceDailyMinutes';
      this.#logger.error?.('budget.config-invalid', { key, error: err?.message, learnerId, ...context });
      return null;
    }
  }

  async open({ learnerId, deviceId }) {
    const cfg = this.#cfg();
    if (cfg.enabled !== true) return ENABLED_FALSE;
    const today = this.#tryToday({ learnerId, deviceId });
    if (today === null) return ENABLED_FALSE;
    const at = this.#clock().toISOString();
    const day = this.#store.loadDay(today);
    const r = applyOpen(day, {
      sessionId: this.#idFactory(), learnerId, deviceId, at, staleAfterSeconds: STALE_AFTER_SECONDS,
    });
    this.#store.saveDay(r.day);
    const bal = this.#tryBalance(r.day, cfg, learnerId, { sessionId: r.sessionId });
    if (bal === null) return ENABLED_FALSE;
    this.#logger.info?.('budget.opened', {
      learnerId, deviceId, sessionId: r.sessionId, adopted: r.adopted,
      cumulativeSeconds: r.cumulativeSeconds, studyDate: r.day.studyDate,
    });
    return {
      enabled: true, sessionId: r.sessionId, cumulativeSeconds: r.cumulativeSeconds,
      ...bal, warnAtSeconds: this.#warnAtSeconds(cfg),
      settleIntervalSec: 60, idleAfterSeconds: cfg.idleAfterSeconds ?? 90,
    };
  }

  async settle({ sessionId, learnerId, cumulativeSeconds }) {
    const cfg = this.#cfg();
    if (cfg.enabled !== true) return DISABLED_SETTLE;
    const today = this.#tryToday({ sessionId, learnerId });
    if (today === null) return DISABLED_SETTLE;
    const at = this.#clock().toISOString();
    let day = this.#store.loadDay(today);
    // A session left open across 4am must not spend yesterday's allowance today.
    // The session lives in the day it opened in; when the study day rolls under
    // it, seal it there and re-open it on the new day at the same high-water, so
    // the client's cumulative keeps meaning the same thing (design D6).
    if (!day.sessions[sessionId]) {
      const carried = this.#carryForward({ sessionId, learnerId, today, at });
      if (carried) { day = carried.day; this.#logger.info?.('budget.day-rollover', carried.event); }
    }
    const r = applySettle(day, { sessionId, cumulativeSeconds, at });
    try {
      this.#store.saveDay(r.day);
    } catch (err) {
      // D16: a swallowed debit is free game time. Loud, then rethrow — this
      // is the one failure mode this service does NOT fail open on, because
      // failing open here means the write silently never happened.
      this.#logger.error?.('budget.settle-failed', {
        sessionId, learnerId, cumulativeSeconds, error: err?.message,
      });
      throw err;
    }
    const bal = this.#tryBalance(r.day, cfg, learnerId, { sessionId });
    if (bal === null) return DISABLED_SETTLE;
    const depleted = bal.learnerSecondsLeft <= 0;
    const deviceDepleted = bal.deviceSecondsLeft <= 0;
    this.#logger.info?.('budget.settled', {
      sessionId, learnerId, chargedSeconds: r.chargedSeconds, secondsLeft: bal.secondsLeft,
      studyDate: r.day.studyDate,
    });
    if (depleted) this.#logger.info?.('budget.depleted', { learnerId, sessionId });
    if (deviceDepleted) this.#logger.info?.('budget.device-depleted', { sessionId });
    return { secondsLeft: bal.secondsLeft, depleted, deviceDepleted };
  }

  async close({ sessionId, learnerId, cumulativeSeconds }) {
    const cfg = this.#cfg();
    if (cfg.enabled !== true) return OK_CLOSE;
    const today = this.#tryToday({ sessionId, learnerId });
    if (today === null) return OK_CLOSE;
    const at = this.#clock().toISOString();
    const day = this.#store.loadDay(today);
    const r = applyClose(day, { sessionId, cumulativeSeconds, at });
    try {
      this.#store.saveDay(r.day);
    } catch (err) {
      this.#logger.error?.('budget.settle-failed', { sessionId, learnerId, cumulativeSeconds, error: err?.message });
      throw err;
    }
    return OK_CLOSE;
  }

  async balance({ learnerId }) {
    const cfg = this.#cfg();
    if (cfg.enabled !== true) return ENABLED_FALSE;
    const today = this.#tryToday({ learnerId });
    if (today === null) return ENABLED_FALSE;
    const day = this.#store.loadDay(today);
    const bal = this.#tryBalance(day, cfg, learnerId, {});
    if (bal === null) return ENABLED_FALSE;
    return { enabled: true, ...bal, warnAtSeconds: this.#warnAtSeconds(cfg) };
  }

  /**
   * Find a session that belongs to an earlier study day and continue it on
   * today's record at the same cumulative high-water. Returns null when there
   * is nothing to carry (an unknown session id — applySettle will throw, which
   * is the honest answer).
   *
   * Only yesterday is searched: a session idle longer than that is past
   * STALE_AFTER_SECONDS and open() would have sealed it anyway.
   */
  #carryForward({ sessionId, learnerId, today, at }) {
    const yesterdayStr = budgetStudyDate(
      new Date(Date.parse(`${today}T12:00:00.000Z`) - 86_400_000), this.#timezone,
    );
    const prev = this.#store.loadDay(yesterdayStr);
    const s = prev.sessions[sessionId];
    if (!s || s.closed) return null;
    s.closed = true;
    this.#store.saveDay(prev);
    const day = this.#store.loadDay(today);
    day.sessions[sessionId] = {
      learnerId: s.learnerId, deviceId: s.deviceId, openedAt: at, lastSettleAt: at,
      cumulativeSeconds: s.cumulativeSeconds, closed: false,
    };
    day.learners[s.learnerId] ??= { totalSeconds: 0 };
    return {
      day,
      event: { learnerId, sessionId, from: yesterdayStr, to: today, cumulativeSeconds: s.cumulativeSeconds },
    };
  }
}

export default PianoGameBudgetService;
