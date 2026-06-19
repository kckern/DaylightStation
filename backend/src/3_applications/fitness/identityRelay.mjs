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
const DEFAULT_PENDING_TTL_MS = 30000;

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

  function emitUnrecognized(modality, at) {
    eventBus.broadcast(IDENTITY_TOPIC, {
      modality, matched: false, userId: null, finger: null,
      authz: { admin: false, locks: [] }, at,
    });
  }

  function handleScan(message) {
    const at = now();
    const modality = message.modality || 'fingerprint';
    if (!message.matched || !message.uuid) {
      emitUnrecognized(modality, at);
      logger.debug?.('identity.unrecognized', { modality });
      return;
    }
    const index = buildFingerprintIdentityIndex(userService?.getAllProfiles?.() || {});
    const entry = index[message.uuid];
    if (!entry) {
      emitUnrecognized(modality, at);
      logger.warn?.('identity.unknown_uuid', { modality });
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
