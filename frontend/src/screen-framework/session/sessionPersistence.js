// Power-cut survival for screens (RQ-RELY-08).
//
// The backend's last canonical snapshot (DeviceLivenessService) lives only in
// server memory — a household power cut takes the server down with the
// screen — so each screen persists its own session in browser storage (FKB /
// kiosk WebViews keep localStorage across a reboot) and re-adopts it PAUSED
// on cold start.
//
// Only a session somebody is still in is kept: playing, paused, buffering,
// loading or stalled. Stopped (`ready`), moved away, ended or idle clears the
// record, so a deliberately stopped screen is never resurrected. A restored
// session that was never resumed is marked `restored` and keeps its ORIGINAL
// `savedAt`; it is not offered a second time.
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ScreenSessionPersistence' });
  return _logger;
}

export const SESSION_STORAGE_PREFIX = 'daylight.screen-session.v2:';
export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const POWER_RESTORE_DELAY_MS = 2_500;
const RESTORABLE_STATES = new Set(['playing', 'paused', 'buffering', 'loading', 'stalled']);

const key = (deviceId) => `${SESSION_STORAGE_PREFIX}${deviceId}`;
const currentOf = (snapshot) => {
  const q = snapshot?.queue;
  return Number.isInteger(q?.currentIndex) && q.currentIndex >= 0 ? q.items?.[q.currentIndex] ?? null : null;
};

/** The part of a snapshot worth restoring, or null when nobody is in a session. */
export function restorableSnapshot(snapshot) {
  if (!snapshot?.currentItem || !RESTORABLE_STATES.has(snapshot.state)) return null;
  if (!Array.isArray(snapshot.queue?.items) || snapshot.queue.items.length === 0) return null;
  if (snapshot.currentItem.isLive === true) return null;
  const { controls: _controls, ...rest } = snapshot;
  const meta = { ...rest.meta };
  delete meta.playbackOwner;
  delete meta.queueOwner;
  return { ...rest, meta };
}

function readRecord(deviceId) {
  const raw = window.localStorage.getItem(key(deviceId));
  if (!raw) return null;
  const record = JSON.parse(raw);
  return record?.v === 2 ? record : null;
}

export function clearPersistedSession(deviceId) {
  try { window.localStorage.removeItem(key(deviceId)); } catch { /* storage unavailable */ }
}

/**
 * Write the full session (queue included). A non-restorable snapshot CLEARS
 * the record. `restored` + `savedAt` carry a restored-never-resumed session's
 * original save time forward.
 * @returns {'saved'|'cleared'|'failed'}
 */
export function savePersistedSession(deviceId, snapshot, modes, { now = Date.now(), restored = false, savedAt = null } = {}) {
  if (!deviceId) return 'failed';
  const restorable = restorableSnapshot(snapshot);
  if (!restorable) { clearPersistedSession(deviceId); return 'cleared'; }
  try {
    window.localStorage.setItem(key(deviceId), JSON.stringify({
      v: 2, savedAt: savedAt ?? new Date(now).toISOString(), restored: !!restored,
      snapshot: restorable, modes: modes ?? null,
    }));
    return 'saved';
  } catch (err) {
    logger().warn('persist-failed', { deviceId, error: err?.message });
    return 'failed';
  }
}

/** Cheap 5s tick: move the spot of the SAME current item; never rewrites the queue. */
export function updatePersistedSpot(deviceId, snapshot, now = Date.now()) {
  try {
    const record = readRecord(deviceId);
    const saved = record?.snapshot;
    const live = currentOf(snapshot) ?? snapshot?.currentItem;
    const kept = currentOf(saved) ?? saved?.currentItem;
    if (!record || record.restored || !live || !kept) return false;
    if ((live.queueItemId ?? live.contentId) !== (kept.queueItemId ?? kept.contentId)) return false;
    if (!Number.isFinite(snapshot.position)) return false;
    record.snapshot = { ...saved, position: snapshot.position };
    record.savedAt = new Date(now).toISOString();
    window.localStorage.setItem(key(deviceId), JSON.stringify(record));
    return true;
  } catch (err) {
    logger().warn('spot-persist-failed', { deviceId, error: err?.message });
    return false;
  }
}

export function loadPersistedSession(deviceId, now = Date.now()) {
  if (!deviceId) return null;
  try {
    const record = readRecord(deviceId);
    if (!record) return null;
    const age = now - Date.parse(record.savedAt);
    const fresh = Number.isFinite(age) && age <= SESSION_MAX_AGE_MS;
    return {
      savedAt: record.savedAt,
      restored: record.restored === true,
      snapshot: fresh ? record.snapshot ?? null : null,
      modes: record.modes ?? null,
    };
  } catch (err) {
    logger().warn('load-failed', { deviceId, error: err?.message });
    return null;
  }
}
