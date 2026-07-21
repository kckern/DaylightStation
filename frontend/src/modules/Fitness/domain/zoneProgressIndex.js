/**
 * zoneProgressIndex — SSOT for resolving a participant's zone-progress entry.
 *
 * Why this exists (2026-07-21 sidebar-sort bug): `userZoneProgress` was keyed
 * ONLY by the user's given name, while the sidebar sort looked entries up by
 * DISPLAY name. `resolveDisplayName` returns the group label ("Dad") first
 * whenever 2+ HR participants are present (userDisplayName.js:30-33), so every
 * lookup for a user with a `group_label` missed and silently degraded to
 * progress 0 — mis-ordering the roster whenever more than one rider was on.
 *
 * The fix is to index every alias a caller might hold, with stable IDs taking
 * precedence over human-facing strings, and to give callers one lookup helper
 * instead of four hand-rolled ones.
 *
 * @module Fitness/domain/zoneProgressIndex
 */

/**
 * Build a lookup index from a userVitals collection.
 *
 * Aliases are added in five passes so precedence is deterministic regardless
 * of iteration order: profile IDs (stable, never a display string) > primary
 * device ID (stable) > secondary device IDs > given names > display labels
 * (group labels like "Dad", which can legitimately collide across users).
 * First writer wins, both within a pass and across passes.
 *
 * Device IDs are indexed because `resolveDisplayName` falls back to the raw
 * device ID string when a strap has no resolved user
 * (userDisplayName.js:167) — so a caller's "display name" can legitimately BE
 * a device ID.
 *
 * Alias matching is TRIMMED but NOT case-folded: "dad" will not find "Dad".
 * This is deliberate — profile and device IDs are case-sensitive, and
 * case-folding them risks collapsing distinct users onto one entry.
 *
 * Reads these fields off each entry: `profileId` (falls back to the
 * collection key), `deviceId`, `deviceIds`, `name`, `displayLabel`.
 *
 * `deviceId` is the user's PRIMARY strap (`user.hrDeviceId`); `deviceIds` is
 * the full strap list (`user.hrDeviceIds`), so multi-strap users resolve from
 * ANY of their straps. This mirrors `participantLookupByDevice`, which already
 * indexes every device ID rather than just the primary.
 *
 * @param {Map<string, Object>|Object|null} userVitals - keyed by profile ID
 * @returns {Map<string, Object>} alias → progress entry
 */
export const buildZoneProgressIndex = (userVitals) => {
  const index = new Map();
  if (!userVitals) return index;

  const raw = [];
  if (userVitals instanceof Map) {
    userVitals.forEach((value, key) => { if (value) raw.push([key, value]); });
  } else if (typeof userVitals === 'object') {
    Object.entries(userVitals).forEach(([key, value]) => { if (value) raw.push([key, value]); });
  }

  // Copy each entry once (backfilling profileId from the map key) so all of an
  // entry's aliases share one object. Note: these are copies — not
  // identity-equal to the input values.
  const entries = raw.map(([key, vitals]) => ({
    ...vitals,
    profileId: vitals.profileId ?? key ?? null,
  }));

  const addAlias = (key, value) => {
    if (key == null) return;
    const normalized = String(key).trim();
    if (!normalized || index.has(normalized)) return;
    index.set(normalized, value);
  };

  entries.forEach((entry) => addAlias(entry.profileId, entry));
  entries.forEach((entry) => addAlias(entry.deviceId, entry));
  entries.forEach((entry) => {
    if (!Array.isArray(entry.deviceIds)) return;
    entry.deviceIds.forEach((id) => addAlias(id, entry));
  });
  entries.forEach((entry) => addAlias(entry.name, entry));
  entries.forEach((entry) => addAlias(entry.displayLabel, entry));

  return index;
};

/**
 * Resolve a progress entry from any identifier a caller happens to hold.
 *
 * ALWAYS pass `profileId` when you have it. Two participants can share a
 * `group_label` (both "Dad"), and the index resolves a shared label to whichever
 * user was indexed first — so a label-only hit is AMBIGUOUS and may return a
 * plausible-but-wrong user's progress. Treat it as a best-effort fallback, not
 * an identification.
 *
 * Matching is trimmed but NOT case-folded; see buildZoneProgressIndex.
 *
 * Returns the ENTRY, not a number. Callers typically write
 * `lookupZoneProgress(...)?.progress ?? 0` — keep the entry-vs-null distinction
 * intact, because a genuine `progress: 0` and a miss both collapse to 0 at the
 * call site and that ambiguity is precisely the 2026-07-21 bug.
 *
 * @param {Map<string, Object>|null} index - from buildZoneProgressIndex
 * @param {Object|Array} keys - { profileId, id, name, displayLabel, deviceId } or an ordered array
 * @returns {Object|null} the progress entry, or null when no candidate matches
 */
export const lookupZoneProgress = (index, keys) => {
  if (!index || !keys) return null;

  const candidates = Array.isArray(keys)
    ? keys
    : [keys.profileId, keys.id, keys.name, keys.displayLabel, keys.deviceId];

  for (const candidate of candidates) {
    if (candidate == null) continue;
    const hit = index.get(String(candidate).trim());
    if (hit) return hit;
  }
  return null;
};

export default { buildZoneProgressIndex, lookupZoneProgress };
