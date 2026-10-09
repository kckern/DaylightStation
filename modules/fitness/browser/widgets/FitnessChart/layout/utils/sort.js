/**
 * Deterministic comparator for avatars.
 * 1. Sort by Y position (ascending)
 * 2. Sort by Value (descending) - higher value usually means "ahead" or "better"
 * 3. Sort by ID (ascending) - deterministic tie-breaker
 */
export const compareAvatars = (a, b) => {
  // 1. Y position
  if (Math.abs(a.y - b.y) > 0.01) {
    return a.y - b.y;
  }

  // 2. Value (if available)
  const valA = a.value ?? 0;
  const valB = b.value ?? 0;
  if (valA !== valB) {
    return valB - valA; // Higher value first? 
    // Actually, usually lower Y means higher value in charts (0 at top), 
    // but here Y seems to be pixel position.
    // If Y is same, we want consistent ordering.
    // Let's stick to ID for pure determinism if Y is same.
  }

  // 3. ID (deterministic tie-breaker)
  const idA = a.id || '';
  const idB = b.id || '';
  return idA.localeCompare(idB);
};

/**
 * Comparator for the FitnessChart legend / roster list (Issue B).
 *
 * Sorts participants so that, within a given HR zone, the user furthest
 * through the zone (higher `progress` 0..1) appears first. This diverges
 * from raw-HR sort because each user has different per-user zone
 * thresholds (e.g. two users at 140 BPM can be 80% vs 20% through "Warm").
 *
 * Keys (all descending unless noted):
 *   1. zoneIndex  — higher zone (e.g. On Fire > Warm > Cool) first
 *   2. progress   — further through the current zone first (0..1)
 *   3. heartRate  — raw HR, tiebreak within same progress
 *   4. id         — ASC, deterministic final tiebreak
 *
 * Missing fields are treated as 0 so offline users (no live HR data)
 * fall to the bottom of their zone, then to the bottom overall.
 *
 * @param {{id?: string, zoneIndex?: number, progress?: number, heartRate?: number}} a
 * @param {{id?: string, zoneIndex?: number, progress?: number, heartRate?: number}} b
 * @returns {number}
 */
export const compareLegendEntries = (a, b) => {
  const za = Number.isFinite(a?.zoneIndex) ? a.zoneIndex : 0;
  const zb = Number.isFinite(b?.zoneIndex) ? b.zoneIndex : 0;
  if (za !== zb) return zb - za;

  const pa = Number.isFinite(a?.progress) ? a.progress : 0;
  const pb = Number.isFinite(b?.progress) ? b.progress : 0;
  if (pa !== pb) return pb - pa;

  const ha = Number.isFinite(a?.heartRate) ? a.heartRate : 0;
  const hb = Number.isFinite(b?.heartRate) ? b.heartRate : 0;
  if (ha !== hb) return hb - ha;

  const ida = a?.id || '';
  const idb = b?.id || '';
  return ida.localeCompare(idb);
};
