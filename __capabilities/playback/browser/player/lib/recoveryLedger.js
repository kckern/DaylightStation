/** Shared owner/visit accounting. Only the incident owner's continuous health observation closes incidents. */
import { getLogger } from '../../../../../frontend/src/lib/logging/Logger.js';
let logger;
const defaultLogger = () => logger || (logger = getLogger().child({ component: 'recovery-ledger' }));
let sessionsCreatedAllLedgers = 0;
export const getSessionsCreatedAllLedgers = () => sessionsCreatedAllLedgers;
export const _resetSessionsCreatedForTests = () => { sessionsCreatedAllLedgers = 0; };
export const RECOVERY_MAX_ATTEMPTS = 3;
const ROLLING_MS = 600000;
const HEALTHY_MS = 60000;
const SAMPLE_EXPIRY_MS = 2000;
const ACTION_DEADLINE_MS = 15000;

export function createRecoveryLedger(options = {}) {
  const cfg = { maxAttempts: 3, rollingMaxAttempts: 6, cooldownMs: 4000, cooldownBackoffMultiplier: 1,
    now: () => globalThis.performance?.now?.() ?? Date.now(), ...options,
    mountBudgets: { 'dash-error': 3, ...options.mountBudgets } };
  const sessions = new Map();
  let sessionsCreated = 0;
  let actionSequence = 0;
  const emit = (event, data) => {
    try { (options.logger || defaultLogger()).sampled(`recovery-ledger.${event}`, data, { maxPerMinute: 30, aggregate: true }); } catch { /* telemetry cannot interrupt accounting */ }
  };
  const get = (key) => {
    if (!sessions.has(key)) {
      sessions.set(key, { count: 0, lastAt: null, createdAt: cfg.now(), urlRefreshCount: 0,
        exhausted: false, mounts: new Map(), history: [], actions: new Map(), inFlight: null, healthAt: null, healthEligible: false, healthySince: null });
      sessionsCreated++; sessionsCreatedAllLedgers++;
    }
    return sessions.get(key);
  };
  const prune = (s, at = cfg.now()) => { s.history = s.history.filter(action => at - action.atMs < ROLLING_MS); };
  const rollingWait = (s) => s.history.length >= cfg.rollingMaxAttempts ? Math.max(0, ROLLING_MS - (cfg.now() - s.history[0].atMs)) : 0;
  const clearIncident = (key, s, reason) => {
    emit('incident-reset', { reason, count: s.count, rollingCount: s.history.length });
    s.count = 0; s.exhausted = false; s.healthySince = null;
  };
  const completeAction = ({ sessionKey, actionId }) => {
    const s = sessions.get(sessionKey);
    if (!s || s.inFlight?.id !== actionId) return false;
    s.inFlight = null;
    // Readiness begins observation, never supplies prior healthy credit.
    s.healthySince = null;
    emit('action-completed', { count: s.count, rollingCount: s.history.length });
    return true;
  };
  const reserveAction = ({ sessionKey, mountId, actor, reason, actionId, bypassCooldown = false, isUrlRefresh = false }) => {
    const id = actionId ?? `legacy-recovery-${++actionSequence}`;
    if (!sessionKey) return { allowed: false, attempt: 0, waitMs: 0, exhausted: false, deniedBy: 'missing-session', actionId: id };
    const s = get(sessionKey); const at = cfg.now(); prune(s, at);
    const previous = s.actions.get(id);
    if (previous) return { allowed: true, duplicate: true, actionId: id, attempt: previous.attempt, waitMs: 0, exhausted: false, deniedBy: null };
    const deny = (deniedBy, waitMs = 0, exhausted = false) => {
      if (exhausted) s.exhausted = true;
      emit('action-denied', { actor, reason, deniedBy, waitMs, count: s.count, rollingCount: s.history.length });
      return { allowed: false, actionId: id, attempt: s.count, waitMs, exhausted, deniedBy };
    };
    if (s.count >= Math.min(3, cfg.maxAttempts)) return deny('session-cap', 0, true);
    if (s.history.length >= Math.min(6, cfg.rollingMaxAttempts)) return deny('rolling-cap', rollingWait(s), true);
    if (s.inFlight) return deny('in-flight', ACTION_DEADLINE_MS - s.inFlight.eligibleMs);
    const budget = cfg.mountBudgets[actor];
    if (Number.isFinite(budget) && mountId && (s.mounts.get(mountId)?.get(actor) || 0) >= budget) return deny('mount-budget');
    const cooldown = Math.max(4000, bypassCooldown ? 0 : cfg.cooldownMs * Math.pow(cfg.cooldownBackoffMultiplier, Math.max(0, s.count - 1)));
    if (s.lastAt !== null && at - s.lastAt < cooldown) return deny('cooldown', cooldown - (at - s.lastAt));
    s.count++; s.lastAt = at; s.healthySince = null;
    s.inFlight = { id, eligibleMs: 0 };
    const action = { id, atMs: at, attempt: s.count };
    s.history.push(action);
    s.actions.set(id, action);
    if (isUrlRefresh) s.urlRefreshCount++;
    if (Number.isFinite(budget) && mountId) {
      if (!s.mounts.has(mountId)) s.mounts.set(mountId, new Map());
      const mount = s.mounts.get(mountId); mount.set(actor, (mount.get(actor) || 0) + 1);
    }
    emit('action-reserved', { actor, reason, count: s.count, rollingCount: s.history.length });
    return { allowed: true, actionId: id, attempt: s.count, waitMs: 0, exhausted: false, deniedBy: null, reason };
  };
  const snapshot = (key) => {
    const s = sessions.get(key); if (!s) return null; prune(s);
    return { count: s.count, lastAt: s.lastAt ?? 0, urlRefreshCount: s.urlRefreshCount, exhausted: s.exhausted,
      rollingCount: s.history.length, inFlightActionId: s.inFlight?.id ?? null, retryAfterMs: rollingWait(s) };
  };
  return {
    reserveAction,
    request: (request) => reserveAction(request),
    completeAction,
    observeHealth({ sessionKey, healthy, atMs, eligible = false }) {
      const s = sessions.get(sessionKey); if (!s || !Number.isFinite(atMs)) return;
      const delta = s.healthAt === null ? null : atMs - s.healthAt;
      const contiguous = delta !== null && delta >= 0 && delta <= SAMPLE_EXPIRY_MS && s.healthEligible && eligible;
      if (s.inFlight && contiguous) {
        s.inFlight.eligibleMs += delta;
        if (s.inFlight.eligibleMs >= ACTION_DEADLINE_MS) {
          emit('action-timeout', { count: s.count, rollingCount: s.history.length });
          completeAction({ sessionKey, actionId: s.inFlight.id });
        }
      }
      s.healthAt = atMs; s.healthEligible = eligible;
      if (!healthy || !eligible || s.inFlight) { s.healthySince = null; return; }
      if (!contiguous || s.healthySince === null) s.healthySince = atMs;
      if (atMs - s.healthySince >= HEALTHY_MS) clearIncident(sessionKey, s, 'sustained-health');
    },
    userReset(key) {
      const s = sessions.get(key); if (!s) return;
      // Explicit Retry cancels its old operation but retains all rolling debit and actor limits.
      if (s.inFlight) completeAction({ sessionKey: key, actionId: s.inFlight.id });
      clearIncident(key, s, 'user-retry');
    },
    releaseSession(key) {
      const s = sessions.get(key); if (!s) return;
      emit('session-released', { releasedBy: 'release', count: s.count, urlRefreshCount: s.urlRefreshCount,
        exhausted: s.exhausted, mountCount: s.mounts.size, ageMs: cfg.now() - s.createdAt, sessionsCreated });
      sessions.delete(key);
    },
    snapshot,
    dumpAll() {
      const at = cfg.now();
      return { sessionsCreated, sessionsLive: sessions.size, atMs: at,
        sessions: [...sessions].map(([key, s]) => ({ sessionKey: key, ...snapshot(key), createdAt: s.createdAt,
          ageMs: at - s.createdAt, mounts: [...s.mounts].map(([mountId, actors]) => ({ mountId, actors: Object.fromEntries(actors) })) })) };
    },
  };
}
let shared = null;
export const getRecoveryLedger = () => shared || (shared = createRecoveryLedger());
export const _setSharedLedgerForTests = (ledger) => { shared = ledger; };
