/**
 * Pure transition detector for the "reached Fire" toast. Given the prior tracker
 * state and the current zone profiles, decide who just crossed into the Fire zone.
 *
 * Rules:
 * - A user's FIRST observation only seeds their zone — it never emits. Someone
 *   already in Fire when the page loads must not be congratulated for a zone they
 *   reached before this UI existed (the same reason ring celebrations seed on attach).
 * - Crossing into 'fire' from any other zone emits, unless that person already
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
  return { lastZone: new Map(), lastFiredAt: new Map() };
}

function cloneTracker(tracker) {
  const source = tracker || createFireZoneTracker();
  return {
    lastZone: new Map(source.lastZone),
    lastFiredAt: new Map(source.lastFiredAt),
  };
}

export function nextFireToasts(tracker, profiles, { now = Date.now() } = {}) {
  const next = cloneTracker(tracker);
  const entries = [];

  (Array.isArray(profiles) ? profiles : []).forEach((profile) => {
    const userId = profile?.id || profile?.profileId;
    if (!userId) return;

    const zone = typeof profile.currentZoneId === 'string'
      ? profile.currentZoneId.toLowerCase()
      : null;
    const seen = next.lastZone.has(userId);
    const previous = next.lastZone.get(userId);
    next.lastZone.set(userId, zone);

    // First sighting seeds only — see the seeding rule above.
    if (!seen) return;
    if (zone !== FIRE_ZONE_ID || previous === FIRE_ZONE_ID) return;

    const lastFiredAt = next.lastFiredAt.get(userId);
    if (Number.isFinite(lastFiredAt) && now - lastFiredAt < FIRE_TOAST_COOLDOWN_MS) return;

    next.lastFiredAt.set(userId, now);
    entries.push({ userId, name: profile.name || userId });
  });

  return { entries, tracker: next };
}

export default nextFireToasts;
