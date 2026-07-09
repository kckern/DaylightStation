/**
 * recoveryLedger — single source of truth for playback-recovery attempt
 * accounting. Replaces: useMediaResilience's module _recoveryTracker,
 * VideoPlayer's dashErrorRefreshAttemptsRef, and gates
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
 */

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
 * @returns {{ request: Function, recordSuccess: Function, userReset: Function, releaseSession: Function, snapshot: Function }}
 */
export function createRecoveryLedger(options = {}) {
  const cfg = { ...DEFAULTS, ...options, mountBudgets: { ...DEFAULTS.mountBudgets, ...(options.mountBudgets || {}) } };
  const sessions = new Map(); // sessionKey -> { count, lastAt, urlRefreshCount, exhausted, mounts: Map<mountId, Map<actor, n>> }

  const getSession = (key) => {
    let s = sessions.get(key);
    if (!s) {
      s = { count: 0, lastAt: 0, urlRefreshCount: 0, exhausted: false, mounts: new Map() };
      sessions.set(key, s);
    }
    return s;
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

    /** Playback resumed — clear attempts/cooldown but keep telemetry counters until release. */
    recordSuccess(sessionKey) {
      const s = sessions.get(sessionKey);
      if (!s) return;
      s.count = 0;
      s.lastAt = 0;
      s.exhausted = false;
      s.mounts.clear();
    },

    /** User-initiated retry from exhausted: full reset. */
    userReset(sessionKey) {
      sessions.delete(sessionKey);
    },

    /** Session ended/changed: prune (prevents unbounded growth on kiosk tabs). */
    releaseSession(sessionKey) {
      sessions.delete(sessionKey);
    },

    // Note: `exhausted` is set lazily on the first denied request (telemetry
    // only; STATUS.exhausted in the consumer remains the UI authority).
    snapshot(sessionKey) {
      const s = sessions.get(sessionKey);
      if (!s) return null;
      return { count: s.count, lastAt: s.lastAt, urlRefreshCount: s.urlRefreshCount, exhausted: s.exhausted };
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
