/**
 * Display-time re-check for a queued Fire ceremony. Pure; consumed by
 * FitnessContext's flush, right before the toast and the fireball sound.
 *
 * Owner rule: a Fire ceremony never happens if the rider is not actually in
 * Fire. A queued entry can wait a long time behind a ring card or another
 * rider's toast; by the time the slot clears the rider may have dropped out,
 * lost their strap, been re-tagged, or the session may have ended. So the
 * entry is judged again against the rider's LIVE zone state, and shown only
 * when every condition still holds. Missing a real ceremony is acceptable;
 * a false one never is.
 */

import { FIRE_ZONE_ID } from './fireZoneTracker.js';

/** A reading older than this is not evidence the rider is in Fire now. */
export const FIRE_CEREMONY_FRESH_MS = 5000;

const fireMinOf = (profile) => (Array.isArray(profile?.zoneConfig) ? profile.zoneConfig : [])
  .find((zone) => zone?.id === FIRE_ZONE_ID)?.min;

/**
 * @param {Object} queued - the tracker entry: { userId, entryId, deviceId, sessionId }
 * @param {Object|null} live - the rider's current ZoneProfileStore profile
 * @param {{ now: number, sessionId: string|null }} context
 * @returns {{ show: boolean, reason: string|null, heartRate: number|null, fireThreshold: number|null }}
 */
export function evaluateFireCeremony(queued, live, { now = Date.now(), sessionId = null } = {}) {
  const heartRate = Number.isFinite(live?.heartRate) ? live.heartRate : null;
  const fireThreshold = Number.isFinite(fireMinOf(live)) ? fireMinOf(live) : null;
  const drop = (reason) => ({ show: false, reason, heartRate, fireThreshold });

  if (!queued || !live) return drop('rider-gone');
  if ((queued.sessionId ?? null) !== (sessionId ?? null) || sessionId == null) return drop('session-changed');
  if (live.zoneTrusted !== true) return drop('untrusted');
  if (String(live.currentZoneId || '').toLowerCase() !== FIRE_ZONE_ID) return drop('not-in-fire');
  // Same uninterrupted Fire stint: leaving Fire, a wearer reset or a resume
  // all replace (or clear) the entry.
  if (live.zoneEntry?.id == null || live.zoneEntry.id !== queued.entryId) return drop('entry-changed');
  if (live.zoneReadingSimulated === true || live.zoneEntry.simulated === true) return drop('simulated');
  if ((live.zoneReadingDeviceId ?? null) !== (queued.deviceId ?? null)) return drop('device-changed');
  if (fireThreshold == null) return drop('no-fire-threshold');
  const readingAt = live.zoneReadingAt;
  if (!(heartRate > 0) || live.zoneReadingEligible === false
      || !Number.isFinite(readingAt) || now - readingAt > FIRE_CEREMONY_FRESH_MS) return drop('hr-stale');
  // The committed zone may hold Fire through the exit margin; the ceremony may not.
  if (heartRate < fireThreshold) return drop('hr-below-fire');
  return { show: true, reason: null, heartRate, fireThreshold };
}

export default evaluateFireCeremony;
