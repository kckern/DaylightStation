/**
 * One member, one SENDING strap — the shared liveness signal and stale-entry
 * release used by GuestAssignmentService (picker) and FitnessSession
 * (auto-assign). See __docs/reference/fitness/assign-guest.md §4a.
 */
import getLogger from "../../../../../../frontend/src/lib/logging/Logger.js";

/**
 * Whether a strap is sending right now, per the session's DeviceManager:
 * present and not marked inactive (pruneStaleDevices stamps inactiveSince
 * after the inactivity timeout and later deletes the device; "Ignore This
 * Strap" deletes it at once). Null when liveness cannot be read — callers
 * then treat the strap as live (conservative).
 * @returns {boolean|null}
 */
export function isDeviceLive(deviceManager, deviceId) {
  if (!deviceManager || typeof deviceManager.getDevice !== 'function') return null;
  const device = deviceManager.getDevice(String(deviceId));
  if (!device) return false;
  return !device.inactiveSince;
}

/**
 * Close a silent strap's stint for its occupant and drop its ledger entry.
 * The stint ends `dropped` at the strap's last packet, so attribution stops
 * where the data stopped. Rings, beats and zones stay keyed by the user id.
 */
export function releaseStaleAssignment(session, deviceId, entry, { toDeviceId = null, now = Date.now(), journal = null } = {}) {
  const key = String(deviceId);
  const occupantId = entry?.metadata?.profileId || entry?.occupantId || null;
  const stint = session?.entityRegistry?.getByDevice?.(key) || null;
  const openStint = stint && stint.status === 'active' && stint.profileId === occupantId ? stint : null;
  const entityId = openStint?.entityId || null;
  const device = session?.deviceManager?.getDevice?.(key) || null;
  const lastSeen = Number.isFinite(device?.lastSeen) ? device.lastSeen : null;
  const endTime = lastSeen != null && lastSeen <= now ? lastSeen : now;
  if (entityId && typeof session.endSessionEntity === 'function') {
    session.endSessionEntity(entityId, { status: 'dropped', timestamp: endTime, reason: 'strap-silent-moved' });
  }
  session?.userManager?.assignGuest?.(key, null);
  session?.userManager?.releaseRuntimeStrap?.(occupantId, key);
  try {
    (journal || session?.eventJournal)?.log?.('STALE_ASSIGNMENT_RELEASED', { deviceId: key, occupantId, entityId, toDeviceId });
  } catch (_) { /* ignore journal errors */ }
  getLogger().info('guest_assignment.stale_entry_released', {
    deviceId: key, userId: occupantId, entityId, toDeviceId, endTime
  });
  return { entityId, occupantId };
}
