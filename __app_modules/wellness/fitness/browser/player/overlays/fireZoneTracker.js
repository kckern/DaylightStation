/**
 * Pure transition detector for the "reached Fire" toast. Given the prior tracker
 * state and the current zone profiles, decide who just crossed into the Fire zone.
 *
 * Rules:
 * - A user's FIRST observation only seeds their zone — it never emits. Someone
 *   already in Fire when the page loads must not be congratulated for a zone they
 *   reached before this UI existed (the same reason ring celebrations seed on attach).
 * - A trusted crossing into 'fire' with new accepted threshold evidence emits, unless that person already
 *   fired within FIRE_TOAST_COOLDOWN_MS.
 * - Staying in Fire emits nothing; only the crossing counts.
 *
 * Reads the STABILIZED zone (`currentZoneId`), so ZoneProfileStore's hysteresis —
 * 5s cooldown, 3s stability, 5bpm exit margin — is what keeps this from chattering
 * at the zone boundary. Never mutates the input tracker; returns the next one.
 */

export const FIRE_ZONE_ID = 'fire';

/** Per-person quiet period. Interval work legitimately re-crosses the line. */
export const FIRE_TOAST_COOLDOWN_MS = 5 * 60 * 1000;

export function createFireZoneTracker() {
  return { lastZone: new Map(), lastFiredAt: new Map(), lastEntryId: new Map() };
}

function cloneTracker(tracker) {
  const source = tracker || createFireZoneTracker();
  return {
    lastZone: new Map(source.lastZone),
    lastFiredAt: new Map(source.lastFiredAt),
    lastEntryId: new Map(source.lastEntryId),
  };
}

export function nextFireToasts(tracker, profiles, { now = Date.now() } = {}) {
  const next = cloneTracker(tracker);
  const entries = [];

  (Array.isArray(profiles) ? profiles : []).forEach((profile) => {
    const userId = profile?.id || profile?.profileId;
    if (!userId) return;

    const zone = profile.zoneTrusted === true && typeof profile.currentZoneId === 'string'
      ? profile.currentZoneId.toLowerCase()
      : null;
    const seen = next.lastZone.has(userId);
    const previous = next.lastZone.get(userId);
    next.lastZone.set(userId, zone);

    // First sighting seeds only — see the seeding rule above.
    if (!seen) {
      if (profile.zoneEntry?.id != null) next.lastEntryId.set(userId, profile.zoneEntry.id);
      return;
    }
    if (!previous || zone !== FIRE_ZONE_ID || previous === FIRE_ZONE_ID) return;

    const fireThreshold = (Array.isArray(profile.zoneConfig) ? profile.zoneConfig : [])
      .find((zone) => zone?.id === FIRE_ZONE_ID)?.min;
    const entry = profile.zoneEntry;
    // A retained zone is not a new achievement. Require the actual accepted
    // crossing and keep its HR, even if display HR changes while a toast waits.
    if (!entry || entry.id == null || entry.id === next.lastEntryId.get(userId)
        || entry.zoneId !== FIRE_ZONE_ID || !Number.isFinite(entry.enteredAt)
        || !Number.isFinite(fireThreshold) || entry.threshold !== fireThreshold
        || !Number.isFinite(entry.heartRate) || entry.heartRate < fireThreshold) return;
    next.lastEntryId.set(userId, entry.id);

    const lastFiredAt = next.lastFiredAt.get(userId);
    if (Number.isFinite(lastFiredAt) && now - lastFiredAt < FIRE_TOAST_COOLDOWN_MS) return;

    next.lastFiredAt.set(userId, now);
    // Carry the justification with the entry. A celebration that cannot say
    // WHY it fired is one nobody can audit: the 2026-09-16 false toast took a
    // cross-log correlation to disprove, because `fire_toast.shown` recorded
    // only a userId and the nearest HR came from a different source.
    entries.push({
      userId,
      name: profile.name || userId,
      heartRate: entry.heartRate,
      fireThreshold: Number.isFinite(fireThreshold) ? fireThreshold : null
    });
  });

  return { entries, tracker: next };
}

export default nextFireToasts;
