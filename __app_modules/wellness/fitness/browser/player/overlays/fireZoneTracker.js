/**
 * Pure transition detector for the "reached Fire" toast. Given the prior tracker
 * state and the current zone profiles, decide who has just EARNED a Fire
 * ceremony.
 *
 * Owner rule: a Fire ceremony never happens if the rider is not actually in
 * Fire. Missing a real ceremony in an ambiguous case is acceptable; a false one
 * never is. So a crossing alone is not enough — it opens a candidate STINT, and
 * the ceremony is earned only by holding it.
 *
 * Rules:
 * - A user's FIRST observation only seeds their zone — it never emits. Someone
 *   already in Fire when the page loads must not be congratulated for a zone they
 *   reached before this UI existed (the same reason ring celebrations seed on attach).
 * - A trusted crossing into 'fire' (previous zone known and not Fire) with new
 *   accepted threshold evidence opens a stint, unless that person already fired
 *   within FIRE_TOAST_COOLDOWN_MS.
 * - The stint becomes a ceremony only after committed Fire has been held for
 *   FIRE_CEREMONY_SUSTAIN_MS with at least FIRE_CEREMONY_MIN_SAMPLES distinct
 *   readings (zoneReadingAt), every one at or above the Fire minimum, all from
 *   the same strap, under the same ladder. Anything else abandons the stint —
 *   leaving Fire, a new entry, a reading below the line, a strap change, a
 *   ladder change, a simulated reading — and only a new real crossing starts
 *   another. This is what one corrupt packet, a 204/real alternation, or two
 *   straps trading places cannot produce.
 * - Staying in Fire emits nothing; only the crossing counts.
 * - A RESUMED entry (ZoneProfileStore re-admitting a rider after a reading loss
 *   or a reload) and a RECLASSIFIED one (the ladder changed under an unchanged
 *   HR) are not crossings: they seed `lastEntryId` and never emit.
 * - A SIMULATED reading (fitness-simulator packets) never emits.
 *
 * Reads the STABILIZED zone (`currentZoneId`), so ZoneProfileStore's hysteresis —
 * 2-sample upward confirmation, 5s cooldown, 3s stability, 5bpm exit margin — is
 * what keeps this from chattering at the zone boundary. Never mutates the input
 * tracker; returns the next one.
 */

export const FIRE_ZONE_ID = 'fire';

/** Per-person quiet period. Interval work legitimately re-crosses the line. */
export const FIRE_TOAST_COOLDOWN_MS = 5 * 60 * 1000;

/** Committed Fire must be held this long before it is celebrated. */
export const FIRE_CEREMONY_SUSTAIN_MS = 5000;
/** ...carried by at least this many distinct accepted readings. */
export const FIRE_CEREMONY_MIN_SAMPLES = 3;

export function createFireZoneTracker() {
  return {
    lastZone: new Map(),
    lastFiredAt: new Map(),
    lastEntryId: new Map(),
    // userId -> the Fire minimum last seen; a change reseeds the rider.
    fireMin: new Map(),
    // userId -> the open candidate stint (see rules above).
    stints: new Map(),
  };
}

function cloneTracker(tracker) {
  const source = tracker || createFireZoneTracker();
  return {
    lastZone: new Map(source.lastZone),
    lastFiredAt: new Map(source.lastFiredAt),
    lastEntryId: new Map(source.lastEntryId),
    fireMin: new Map(source.fireMin || []),
    stints: new Map([...(source.stints || new Map())].map(([id, stint]) => [id, { ...stint }])),
  };
}

const fireMinOf = (profile) => {
  const min = (Array.isArray(profile?.zoneConfig) ? profile.zoneConfig : [])
    .find((zone) => zone?.id === FIRE_ZONE_ID)?.min;
  return Number.isFinite(min) ? min : null;
};

export function nextFireToasts(tracker, profiles, { now = Date.now() } = {}) {
  const next = cloneTracker(tracker);
  const entries = [];
  // Stints that were opened and then did not qualify, with why — the caller
  // logs them, so a missed ceremony can be explained as easily as a shown one.
  const dropped = [];

  (Array.isArray(profiles) ? profiles : []).forEach((profile) => {
    const userId = profile?.id || profile?.profileId;
    if (!userId) return;

    const abandon = (reason) => {
      const stint = next.stints.get(userId);
      if (!stint) return;
      next.stints.delete(userId);
      dropped.push({ userId, entryId: stint.entryId, reason, samples: stint.samples, heldMs: now - stint.startedAt });
    };

    const zone = profile.zoneTrusted === true && typeof profile.currentZoneId === 'string'
      ? profile.currentZoneId.toLowerCase()
      : null;
    const fireThreshold = fireMinOf(profile);
    const seen = next.lastZone.has(userId);
    const previous = next.lastZone.get(userId);
    const priorFireMin = next.fireMin.has(userId) ? next.fireMin.get(userId) : fireThreshold;
    const ladderChanged = seen && priorFireMin !== fireThreshold;
    next.lastZone.set(userId, zone);
    next.fireMin.set(userId, fireThreshold);
    const entry = profile.zoneEntry;

    // First sighting seeds only — see the seeding rule above. A changed Fire
    // line is treated the same way: whatever zone the new ladder puts the
    // rider in was not reached by a crossing.
    if (!seen || ladderChanged) {
      if (ladderChanged) {
        abandon('ladder-changed');
        next.lastZone.set(userId, null);
      }
      if (entry?.id != null) next.lastEntryId.set(userId, entry.id);
      return;
    }
    if ((entry?.resumed === true || entry?.reclassified === true) && entry.id != null) {
      if (next.stints.get(userId)?.entryId !== entry.id) abandon(entry.resumed ? 'resumed' : 'reclassified');
      next.lastEntryId.set(userId, entry.id);
      return;
    }

    const stint = next.stints.get(userId);
    if (stint) {
      if (zone !== FIRE_ZONE_ID) { abandon(zone ? 'left-fire' : 'untrusted'); return; }
      if (entry?.id !== stint.entryId) { abandon('entry-changed'); return; }
      if (fireThreshold !== stint.fireThreshold) { abandon('ladder-changed'); return; }
      if (profile.zoneReadingSimulated === true) { abandon('simulated'); return; }
      if ((profile.zoneReadingDeviceId ?? null) !== stint.deviceId) { abandon('device-changed'); return; }
      const hr = profile.heartRate;
      const at = profile.zoneReadingAt;
      if (Number.isFinite(hr) && hr > 0 && Number.isFinite(at) && at !== stint.lastSampleAt) {
        if (hr < stint.fireThreshold) { abandon('hr-below-fire'); return; }
        stint.samples += 1;
        stint.lastSampleAt = at;
      }
      const heldMs = now - stint.startedAt;
      if (heldMs < FIRE_CEREMONY_SUSTAIN_MS || stint.samples < FIRE_CEREMONY_MIN_SAMPLES) return;
      next.stints.delete(userId);
      const lastFiredAt = next.lastFiredAt.get(userId);
      if (Number.isFinite(lastFiredAt) && now - lastFiredAt < FIRE_TOAST_COOLDOWN_MS) return;
      next.lastFiredAt.set(userId, now);
      // Carry the justification with the entry. A celebration that cannot say
      // WHY it fired is one nobody can audit: the 2026-09-16 false toast took a
      // cross-log correlation to disprove, because `fire_toast.shown` recorded
      // only a userId and the nearest HR came from a different source.
      entries.push({
        userId,
        name: stint.name,
        heartRate: stint.entryHeartRate,
        fireThreshold: stint.fireThreshold,
        // Join keys to fitness.zone_state.transition, so a ceremony can be
        // audited without matching rows by time.
        entryId: stint.entryId,
        previousZoneId: stint.previousZoneId,
        deviceId: stint.deviceId,
        sustainedMs: heldMs,
        samples: stint.samples
      });
      return;
    }

    if (!previous || zone !== FIRE_ZONE_ID || previous === FIRE_ZONE_ID) return;

    // A retained zone is not a new achievement. Require the actual accepted
    // crossing and keep its HR, even if display HR changes while a toast waits.
    if (!entry || entry.id == null || entry.id === next.lastEntryId.get(userId)
        || entry.zoneId !== FIRE_ZONE_ID || !Number.isFinite(entry.enteredAt)
        || !Number.isFinite(fireThreshold) || entry.threshold !== fireThreshold
        || !Number.isFinite(entry.heartRate) || entry.heartRate < fireThreshold) return;
    next.lastEntryId.set(userId, entry.id);

    if (entry.simulated === true || profile.zoneReadingSimulated === true) {
      dropped.push({ userId, entryId: entry.id, reason: 'simulated', samples: 0, heldMs: 0 });
      return;
    }
    const lastFiredAt = next.lastFiredAt.get(userId);
    if (Number.isFinite(lastFiredAt) && now - lastFiredAt < FIRE_TOAST_COOLDOWN_MS) return;

    // The reading in hand is the stint's first sample — if it is a real one
    // at or above the line. A reading below the line already disqualifies it.
    const hr = profile.heartRate;
    const at = profile.zoneReadingAt;
    const counts = Number.isFinite(hr) && hr > 0 && Number.isFinite(at);
    if (counts && hr < fireThreshold) {
      dropped.push({ userId, entryId: entry.id, reason: 'hr-below-fire', samples: 0, heldMs: 0 });
      return;
    }
    next.stints.set(userId, {
      entryId: entry.id,
      entryHeartRate: entry.heartRate,
      fireThreshold,
      previousZoneId: previous,
      name: profile.name || userId,
      deviceId: profile.zoneReadingDeviceId ?? null,
      startedAt: now,
      samples: counts ? 1 : 0,
      lastSampleAt: counts ? at : null
    });
  });

  return { entries, tracker: next, dropped };
}

export default nextFireToasts;
