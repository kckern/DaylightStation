/**
 * recoveryLedger — single source of truth for playback-recovery attempt
 * accounting. Replaced useMediaResilience's module _recoveryTracker and
 * VideoPlayer's per-mount dash-error ref counter; gates
 * useCommonMediaController's nudge.
 *
 * Scope model (audit 2026-07-09 §8 Phase 1): one session-scoped total cap +
 * cooldown-with-backoff, plus per-mount sub-budgets for actors that earn a
 * fresh budget on remount (a remount mints a new Plex session, so a dead-URL
 * actor's cap must not leak across mounts).
 *
 * Kept pure (no DOM/React, injectable clock) so the accounting is
 * unit-testable; the hooks wire it to their actuators.
 *
 * Behavior change vs the old _recoveryTracker (2026-07-09): the cooldown
 * exponent is now (attempts - 1), so the FIRST retry waits cooldownMs (4s)
 * instead of 12s, and the exhaustion floor drops from ~480s to ~160s. This
 * is deliberate — it matches the old code's own documented intent
 * ("4s → 12s → 36s → 108s"), which the old implementation never delivered.
 *
 * Auditability (2026-08-16): the three teardown paths used to erase state
 * without a word. During the remount storm media identity churned on every
 * remount, so `releaseSession` fired constantly and deleted the attempt record
 * each time, restoring the 5-attempt cap to zero — which is why every recovery
 * logged attempt=1 forever, and why "the cap keeps resetting" could not be told
 * apart from "the cap was never reached" from the logs alone. Each teardown now
 * emits what it is about to destroy, and `dumpAll()` answers "what does the
 * ledger hold right now" without the caller having to already know the key.
 *
 * `sessionsCreated` counts distinct session keys this ledger has ever tracked —
 * one per media identity — and lives outside the sessions Map so a release
 * cannot lower it. Each new identity is a remount, and each remount mints a
 * fresh Plex transcode session, so this is the client-side stand-in for the
 * 495-session count that had to be read off Plex's server log. It is a count of
 * identities observed here, not of sessions confirmed at the server.
 */

import { getLogger } from '../../../lib/logging/Logger.js';

// Lazy child logger — the convention in CLAUDE.md for non-component code.
// Resolving it at import time would race the logger's own configuration, and
// this module is imported by hooks, so it must stay cheap to load.
let _logger;
const defaultLogger = () => {
  if (!_logger) _logger = getLogger().child({ component: 'recovery-ledger' });
  return _logger;
};

// Mints across every ledger in the tab. Monotonic and deliberately outside the
// sessions Map, so releasing a session cannot lower it. Production runs a single
// shared ledger, so in practice this and the per-ledger count agree; they differ
// only when something constructs a second ledger (tests do).
let _sessionsCreatedAllLedgers = 0;

/** Total recovery sessions minted in this tab, across all ledgers. Never decreases. */
export function getSessionsCreatedAllLedgers() {
  return _sessionsCreatedAllLedgers;
}

/** Test-only: the tab-wide mint counter is process-lifetime state. */
export function _resetSessionsCreatedForTests() {
  _sessionsCreatedAllLedgers = 0;
}

// Session-wide recovery cap (all actors). The ledger is the single source of
// truth for this number — consumers import it for log payloads/UI copy rather
// than carrying their own configurable (and therefore lying) copy.
export const RECOVERY_MAX_ATTEMPTS = 5;

const DEFAULTS = {
  maxAttempts: RECOVERY_MAX_ATTEMPTS,
  cooldownMs: 4000,
  cooldownBackoffMultiplier: 3,
  mountBudgets: { 'dash-error': 3 },
  now: () => Date.now()
};

/**
 * @param {Object} [options]
 * @param {number} [options.maxAttempts=5] - session-wide recovery cap (all actors)
 * @param {number} [options.cooldownMs=4000] - base cooldown after attempt 1
 * @param {number} [options.cooldownBackoffMultiplier=3] - cooldown growth per attempt
 * @param {Object<string, number>} [options.mountBudgets] - per-mount attempt caps by actor
 * @param {Function} [options.now=Date.now] - injectable clock for tests
 * @param {Object} [options.logger] - injected logger; defaults to the lazily-resolved child logger
 * @returns {{ request: Function, recordSuccess: Function, userReset: Function, releaseSession: Function, snapshot: Function, dumpAll: Function }}
 */
export function createRecoveryLedger(options = {}) {
  const cfg = { ...DEFAULTS, ...options, mountBudgets: { ...DEFAULTS.mountBudgets, ...(options.mountBudgets || {}) } };
  const sessions = new Map(); // sessionKey -> { count, lastAt, createdAt, urlRefreshCount, exhausted, mounts: Map<mountId, Map<actor, n>> }
  const log = () => options.logger || defaultLogger();

  // Mints for THIS ledger. Held outside `sessions` so a release cannot lower it.
  let sessionsCreated = 0;

  const getSession = (key) => {
    let s = sessions.get(key);
    if (!s) {
      s = { count: 0, lastAt: 0, createdAt: cfg.now(), urlRefreshCount: 0, exhausted: false, mounts: new Map() };
      sessions.set(key, s);
      sessionsCreated += 1;
      _sessionsCreatedAllLedgers += 1;
    }
    return s;
  };

  /**
   * Report what a teardown is about to destroy. Rate-limited because identity
   * churn can fire `releaseSession` hundreds of times a minute — which is the
   * condition this event exists to expose, so the aggregate's skippedCount is
   * itself the diagnosis and must not be drowned.
   *
   * @param {string} sessionKey
   * @param {Object} s - the live session, read BEFORE it is mutated or deleted
   * @param {'release'|'user-reset'|'success'} releasedBy
   */
  const reportTeardown = (sessionKey, s, releasedBy) => {
    try {
      log().sampled('recovery-ledger.session-released', {
        sessionKey,
        releasedBy,
        count: s.count,
        urlRefreshCount: s.urlRefreshCount,
        exhausted: s.exhausted,
        mountCount: s.mounts.size,
        ageMs: cfg.now() - s.createdAt,
        sessionsCreated
      }, { maxPerMinute: 30, aggregate: true });
    } catch (_) {
      // Accounting must not fail because reporting did.
    }
  };

  return {
    /**
     * Ask permission to fire a recovery. Records the attempt when allowed.
     * @returns {{allowed:boolean, attempt:number, waitMs:number, exhausted:boolean, deniedBy:null|'cooldown'|'mount-budget'|'session-cap'}}
     */
    request({ sessionKey, mountId, actor, reason, bypassCooldown = false, isUrlRefresh = false }) {
      if (!sessionKey) return { allowed: true, attempt: 0, waitMs: 0, exhausted: false, deniedBy: null };
      const s = getSession(sessionKey);
      const t = cfg.now();

      if (s.count >= cfg.maxAttempts) {
        s.exhausted = true;
        return { allowed: false, attempt: s.count, waitMs: 0, exhausted: true, deniedBy: 'session-cap' };
      }

      const budget = cfg.mountBudgets[actor];
      if (Number.isFinite(budget) && mountId) {
        const mount = s.mounts.get(mountId);
        const used = mount?.get(actor) || 0;
        if (used >= budget) {
          return { allowed: false, attempt: s.count, waitMs: 0, exhausted: false, deniedBy: 'mount-budget' };
        }
      }

      // s.count at check time = number of PRIOR recorded attempts, so the
      // cooldown owed after attempt N uses exponent N-1: 4s, 12s, 36s, ...
      const effectiveCooldown = cfg.cooldownMs * Math.pow(cfg.cooldownBackoffMultiplier, Math.max(0, s.count - 1));
      const elapsed = t - s.lastAt;
      if (!bypassCooldown && s.lastAt > 0 && elapsed < effectiveCooldown) {
        return { allowed: false, attempt: s.count, waitMs: effectiveCooldown - elapsed, exhausted: false, deniedBy: 'cooldown' };
      }

      s.count += 1;
      s.lastAt = t;
      if (isUrlRefresh) s.urlRefreshCount += 1;
      if (Number.isFinite(budget) && mountId) {
        let mount = s.mounts.get(mountId);
        if (!mount) { mount = new Map(); s.mounts.set(mountId, mount); }
        mount.set(actor, (mount.get(actor) || 0) + 1);
      }
      return { allowed: true, attempt: s.count, waitMs: 0, exhausted: false, deniedBy: null, reason };
    },

    /**
     * Playback resumed — clear attempts/cooldown but keep telemetry counters
     * until release. Reports only when there was an attempt record to erase: a
     * success against an already-clean session destroyed nothing, and this is
     * called on every forward-progress tick, so reporting those would be noise
     * with no content.
     */
    recordSuccess(sessionKey) {
      const s = sessions.get(sessionKey);
      if (!s) return;
      if (s.count > 0 || s.mounts.size > 0) reportTeardown(sessionKey, s, 'success');
      s.count = 0;
      s.lastAt = 0;
      s.exhausted = false;
      s.mounts.clear();
    },

    /** User-initiated retry from exhausted: full reset. */
    userReset(sessionKey) {
      const s = sessions.get(sessionKey);
      if (!s) return;
      reportTeardown(sessionKey, s, 'user-reset');
      sessions.delete(sessionKey);
    },

    /**
     * Session ended/changed: prune (prevents unbounded growth on kiosk tabs).
     * A release of a key that was never minted destroyed nothing, so it reports
     * nothing — `sessionsCreated` remains the authority on how many existed.
     */
    releaseSession(sessionKey) {
      const s = sessions.get(sessionKey);
      if (!s) return;
      reportTeardown(sessionKey, s, 'release');
      sessions.delete(sessionKey);
    },

    // Note: `exhausted` is set lazily on the first denied request (telemetry
    // only; STATUS.exhausted in the consumer remains the UI authority).
    snapshot(sessionKey) {
      const s = sessions.get(sessionKey);
      if (!s) return null;
      return { count: s.count, lastAt: s.lastAt, urlRefreshCount: s.urlRefreshCount, exhausted: s.exhausted };
    },

    /**
     * Everything the ledger currently holds, plus the mint count that outlives
     * it. `snapshot()` answers only about a key you already know and omits
     * `mounts` entirely, so there was no way to ask what state exists — during
     * the 2026-08-16 storm `sessionsCreated` would have read ~495 while the live
     * map held a single fresh session, which is the whole shape of that bug in
     * two numbers.
     *
     * Returns plain copies: the caller can log or mutate the result without
     * reaching into the ledger's live Maps.
     */
    dumpAll() {
      const t = cfg.now();
      return {
        sessionsCreated,
        sessionsLive: sessions.size,
        atMs: t,
        sessions: Array.from(sessions.entries()).map(([sessionKey, s]) => ({
          sessionKey,
          count: s.count,
          lastAt: s.lastAt,
          createdAt: s.createdAt,
          ageMs: t - s.createdAt,
          urlRefreshCount: s.urlRefreshCount,
          exhausted: s.exhausted,
          mounts: Array.from(s.mounts.entries()).map(([mountId, actors]) => ({
            mountId,
            actors: Object.fromEntries(actors)
          }))
        }))
      };
    }
  };
}

// Module singleton shared by every actuator in the tab.
let _shared = null;
export function getRecoveryLedger() {
  if (!_shared) _shared = createRecoveryLedger();
  return _shared;
}

// Test-only: swap the singleton.
export function _setSharedLedgerForTests(ledger) {
  _shared = ledger;
}
