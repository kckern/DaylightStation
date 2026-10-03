// Power-cut survival for screens (RQ-RELY-08).
//
// The backend's last canonical snapshot (DeviceLivenessService) lives only in
// server memory — a household power cut takes the server down with the
// screen — so each screen persists its own session in browser storage (FKB /
// kiosk WebViews keep localStorage across a reboot) and re-adopts it PAUSED
// on cold start. Persisted: item, spot, queue, config, and the session modes
// (Add only, end-of-queue, stop after current, sleep resume point).
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ScreenSessionPersistence' });
  return _logger;
}

export const SESSION_STORAGE_PREFIX = 'daylight.screen-session.v1:';
export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const POWER_RESTORE_DELAY_MS = 2_500;
const RESTORABLE_STATES = new Set(['playing', 'paused', 'buffering', 'loading', 'stalled', 'ready']);

const key = (deviceId) => `${SESSION_STORAGE_PREFIX}${deviceId}`;

/** The part of a snapshot worth restoring, or null when nothing is loaded. */
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

export function savePersistedSession(deviceId, snapshot, modes, now = Date.now()) {
  if (!deviceId) return false;
  try {
    const record = { v: 1, savedAt: new Date(now).toISOString(), snapshot: restorableSnapshot(snapshot), modes: modes ?? null };
    window.localStorage.setItem(key(deviceId), JSON.stringify(record));
    return true;
  } catch (err) {
    logger().warn('persist-failed', { deviceId, error: err?.message });
    return false;
  }
}

export function loadPersistedSession(deviceId, now = Date.now()) {
  if (!deviceId) return null;
  try {
    const raw = window.localStorage.getItem(key(deviceId));
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (record?.v !== 1) return null;
    const age = now - Date.parse(record.savedAt);
    const snapshot = Number.isFinite(age) && age <= SESSION_MAX_AGE_MS ? record.snapshot ?? null : null;
    return { savedAt: record.savedAt, snapshot, modes: record.modes ?? null };
  } catch (err) {
    logger().warn('load-failed', { deviceId, error: err?.message });
    return null;
  }
}
