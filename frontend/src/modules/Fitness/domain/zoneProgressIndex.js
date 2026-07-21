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
 * Aliases are added in three passes so precedence is deterministic regardless
 * of iteration order: profile IDs (stable, never a display string) > given
 * names > display labels (group labels like "Dad", which can legitimately
 * collide across users). First writer wins within a pass.
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

  // Normalize once so every alias points at the same object identity.
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
  entries.forEach((entry) => addAlias(entry.name, entry));
  entries.forEach((entry) => addAlias(entry.displayLabel, entry));

  return index;
};

/**
 * Resolve a progress entry from any identifier a caller happens to hold.
 *
 * @param {Map<string, Object>|null} index - from buildZoneProgressIndex
 * @param {Object|Array} keys - { profileId, id, name, displayLabel, deviceId } or an ordered array
 * @returns {Object|null}
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
