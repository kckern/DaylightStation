// Backend relay: subscribes to the garage's dumb `biometric.scan`, enriches it with
// identity + authorization facts, and rebroadcasts `fitness.identity.detected` for the
// frontend IdentityManager. Also maintains the short-lived pending-detection that the
// /emergency/{commit,abort,release} endpoints consume (the guard the old detector gave).
// Admins implicitly hold this lock — it gates admin-only surfaces (e.g. the
// fingerprint manager) AND is the sole authority for the emergency shutdown
// (arm / abort / release). There is no separate "emergency" group: emergency
// authority == admin. Kept in sync with fitness.yml `users.admin` rather than
// hand-maintained in the `locks` map, so adding an admin can't desync the gate.
export const ADMIN_LOCK = 'admin';

const SCAN_TOPIC = 'biometric.scan';
const IDENTITY_TOPIC = 'fitness.identity.detected';
const CEREMONY_TOPIC = 'fitness.emergency.ceremony';
const DEFAULT_PENDING_TTL_MS = 30000;

// Scanner-abuse auto-lockdown defaults (overridable via fitness.yml emergency.abuse).
const DEFAULT_ABUSE_THRESHOLD = 3;
const DEFAULT_ABUSE_WINDOW_SEC = 30;
// After a trip, ignore further failed scans for this long so the in-flight ceremony
// (and the lock it produces) isn't re-tripped. Once the lock is active getLockdownState
// keeps suppressing; an aborted ceremony resumes counting after this window.
const ABUSE_COOLDOWN_MS = 60000;
// Sentinel recorded as lockedBy when the lockdown is auto-tripped by scanner abuse.
const ABUSE_USER = 'abuse-protection';

export function buildFingerprintIdentityIndex(profiles) {
  const index = {};
  const entries = profiles instanceof Map ? [...profiles.entries()] : Object.entries(profiles || {});
  for (const [username, profile] of entries) {
    const fingerprints = profile?.identities?.fingerprints || [];
    for (const fp of fingerprints) {
      if (fp && fp.id) index[fp.id] = { userId: username, finger: fp.finger || null };
    }
  }
  return index;
}

export function buildAuthz(username, fitnessConfig) {
  const locks = [];
  const locksMap = fitnessConfig?.locks || {};
  for (const [lockId, users] of Object.entries(locksMap)) {
    if (Array.isArray(users) && users.includes(username)) {
      locks.push(lockId);
    }
  }
  // Admins implicitly hold the ADMIN_LOCK (from fitness.yml users.admin) and ARE
  // the emergency authority — arming/aborting/releasing the shutdown all require
  // admin. `admin` is the single fact consumers gate on; there is no separate
  // "emergency" flag or group.
  const admins = fitnessConfig?.users?.admin || [];
  const isAdmin = Array.isArray(admins) && admins.includes(username);
  if (isAdmin && !locks.includes(ADMIN_LOCK)) {
    locks.push(ADMIN_LOCK);
  }
  return { admin: isAdmin, locks };
}

// How long an admin scan authorizes manage operations (enroll-verify / delete)
// without a second scan. The fingerprint manager is admin-gated on entry; this
// lets the gate's scan stand in for the per-operation verify within the session.
const DEFAULT_ADMIN_SESSION_TTL_MS = 300000; // 5 min

export function createIdentityRelay({
  eventBus,
  userService,
  loadFitnessConfig,
  getLockdownState = null,
  now = () => Date.now(),
  pendingTtlMs = DEFAULT_PENDING_TTL_MS,
  adminSessionTtlMs = DEFAULT_ADMIN_SESSION_TTL_MS,
  logger = console,
}) {
  if (!eventBus || typeof eventBus.broadcast !== 'function' || typeof eventBus.onClientMessage !== 'function') {
    throw new Error('createIdentityRelay: eventBus with broadcast() and onClientMessage() is required');
  }

  let pending = null;   // { userId, at } — emergency ceremony guard
  let lastAdmin = null; // { userId, at } — most recent admin verification (sliding session)
  let failedTimes = [];        // ms timestamps of recent failed scans (abuse counter)
  let abuseSuppressUntil = 0;  // ms; ignore failed scans until this time after a trip

  function emitUnrecognized(modality, at) {
    eventBus.broadcast(IDENTITY_TOPIC, {
      modality, matched: false, userId: null, finger: null,
      authz: { admin: false, locks: [] }, at,
    });
  }

  // Auto-trip: stamp a synthetic pending so the existing frontend ceremony →
  // POST /commit path locks unchanged, then broadcast the "start ceremony" signal.
  async function tripAbuse(at, threshold, windowMs) {
    // Never auto-trip while a lockdown is already active: a synthetic pending stamped
    // during a lock would let the LockedScreen press-and-hold release succeed without
    // an admin scan (it consumes pending too). Bail if already locked.
    if (getLockdownState) {
      try {
        const state = await getLockdownState.execute({ now: Math.floor(at / 1000) });
        if (state) return; // already locked — never stamp a pending /release could consume
      } catch (err) {
        // Fail CLOSED. A missed abuse-trip is harmless (the next failed scan re-evaluates),
        // but stamping a synthetic pending while the lock state is unknown could let
        // /release succeed without an admin scan. Don't trip on a lookup error.
        logger.warn?.('identity.abuse_lockcheck_failed', { message: err?.message ?? null });
        return;
      }
    }
    pending = { userId: ABUSE_USER, at: now() };
    eventBus.broadcast(CEREMONY_TOPIC, {
      reason: 'abuse', count: threshold, windowSec: Math.round(windowMs / 1000), at,
    });
    logger.warn?.('identity.abuse_tripped', { count: threshold, windowSec: Math.round(windowMs / 1000) });
  }

  // Feed each scan's outcome into the sliding-window abuse counter. A safe
  // (authorized) scan breaks the streak; threshold failures within the window trip.
  function recordScanOutcome(failed, at) {
    const abuseCfg = loadFitnessConfig?.()?.emergency?.abuse || {};
    if (abuseCfg.enabled === false) return;
    if (!failed) { failedTimes = []; return; }
    if (at < abuseSuppressUntil) return;
    const threshold = Number(abuseCfg.threshold) > 0 ? Math.floor(Number(abuseCfg.threshold)) : DEFAULT_ABUSE_THRESHOLD;
    const windowMs = (Number(abuseCfg.window_sec) > 0 ? Number(abuseCfg.window_sec) : DEFAULT_ABUSE_WINDOW_SEC) * 1000;
    failedTimes.push(at);
    failedTimes = failedTimes.filter((t) => at - t < windowMs);
    if (failedTimes.length >= threshold) {
      failedTimes = [];
      abuseSuppressUntil = at + ABUSE_COOLDOWN_MS; // sync guard against re-entrant trips
      tripAbuse(at, threshold, windowMs).catch((err) =>
        logger.warn?.('identity.abuse_trip_failed', { message: err?.message ?? null }));
    }
  }

  function handleScan(message) {
    const at = now();
    const modality = message.modality || 'fingerprint';
    if (!message.matched || !message.uuid) {
      emitUnrecognized(modality, at);
      logger.debug?.('identity.unrecognized', { modality });
      recordScanOutcome(true, at);
      return;
    }
    const index = buildFingerprintIdentityIndex(userService?.getAllProfiles?.() || {});
    const entry = index[message.uuid];
    if (!entry) {
      emitUnrecognized(modality, at);
      logger.warn?.('identity.unknown_uuid', { modality });
      recordScanOutcome(true, at);
      return;
    }
    const fitnessConfig = loadFitnessConfig?.() || {};
    const authz = buildAuthz(entry.userId, fitnessConfig);
    // Admin IS the emergency authority: the same scan stamps both the short-lived
    // pending detection (consumed by /emergency/{commit,abort,release}) and the
    // longer admin session (manage operations).
    if (authz.admin) {
      pending = { userId: entry.userId, at };
      lastAdmin = { userId: entry.userId, at };
      logger.info?.('identity.pending_stamped', { userId: entry.userId });
      logger.info?.('identity.admin_verified', { userId: entry.userId });
    }
    eventBus.broadcast(IDENTITY_TOPIC, {
      modality, matched: true, userId: entry.userId, finger: entry.finger, authz, at,
    });
    logger.info?.('identity.detected', {
      userId: entry.userId, finger: entry.finger, admin: authz.admin, locks: authz.locks.length,
    });
    // Recognized members holding ≥1 lock are legitimate (resets the abuse streak);
    // a recognized identity holding NO locks counts as a failed/abusive scan.
    recordScanOutcome(authz.locks.length === 0, at);
  }

  eventBus.onClientMessage((_clientId, message) => {
    if (!message || message.topic !== SCAN_TOPIC) return;
    handleScan(message);
  });

  return {
    consumePendingDetection(nowMs = now()) {
      if (!pending) return null;
      if (nowMs - pending.at > pendingTtlMs) { pending = null; return null; }
      const consumed = pending;
      pending = null;
      return consumed;
    },
    // Non-consuming: was an admin verified within the session window? Manage
    // operations reuse the admin-gate scan instead of demanding a second one.
    adminVerifiedWithin(ttlMs = adminSessionTtlMs, nowMs = now()) {
      if (!lastAdmin) return null;
      if (nowMs - lastAdmin.at > ttlMs) { lastAdmin = null; return null; }
      return { userId: lastAdmin.userId, at: lastAdmin.at };
    },
  };
}
