import { DaylightMediaPath } from '../../lib/api.mjs';

/**
 * Builds a display-ready map of participants from roster + ZoneProfileStore.
 * Single source of truth for "how to render a participant."
 * Exported for testability — used in FitnessContext via useMemo.
 *
 * The ROSTER is the ground truth for "who is participating."
 * ZoneProfileStore profiles ENRICH roster entries with zone detail.
 * This ensures the display map always has entries even when the
 * ZoneProfileStore is empty (e.g., during startup discard window).
 *
 * @param {Array} profiles - From ZoneProfileStore.getProfiles()
 * @param {Array} roster - Session roster with avatar/metadata
 * @returns {Map<string, DisplayEntry>} Normalized name → display entry
 */
export function buildParticipantDisplayMap(profiles, roster) {
  const map = new Map();
  const normalize = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

  // Index profiles by normalized name and ID for fast lookup
  const profileIndex = new Map();
  (profiles || []).forEach((profile) => {
    if (!profile?.id) return;
    const nameKey = normalize(profile.name || profile.displayName || '');
    const idKey = normalize(profile.id);
    if (nameKey) profileIndex.set(nameKey, profile);
    if (idKey) profileIndex.set(idKey, profile);
  });

  const buildEntry = (id, rosterEntry, profile) => {
    const resolvedProfileId = profile?.profileId || profile?.id || rosterEntry?.profileId || id;
    const rawAvatar = rosterEntry?.avatarUrl
      || (resolvedProfileId ? `/static/img/users/${resolvedProfileId}` : '/static/img/users/user');
    const avatarSrc = DaylightMediaPath(rawAvatar);

    return {
      id: profile?.id || resolvedProfileId || id,
      displayName: profile?.displayName || profile?.name || rosterEntry?.displayLabel || rosterEntry?.name || id,
      avatarSrc,
      heartRate: profile?.heartRate ?? rosterEntry?.heartRate ?? null,
      zoneId: profile?.currentZoneId || rosterEntry?.zoneId || null,
      zoneName: profile?.currentZoneName || null,
      zoneColor: profile?.currentZoneColor || rosterEntry?.zoneColor || null,
      progress: profile?.progress ?? null,
      targetHeartRate: profile?.targetHeartRate ?? null,
      zoneSequence: profile?.zoneSequence || [],
      groupLabel: profile?.groupLabel || rosterEntry?.groupLabel || null,
      source: profile ? (profile.source || 'profile') : 'roster',
      updatedAt: profile?.updatedAt || null
    };
  };

  const seen = new Set();

  // Primary: iterate roster (ground truth for "who is participating")
  (roster || []).forEach((r) => {
    if (!r) return;
    const nameKey = normalize(r.name || '');
    const idKey = normalize(r.profileId || r.id || '');
    const key = idKey || nameKey;
    if (!key || seen.has(key)) return;
    seen.add(key);
    if (nameKey) seen.add(nameKey);
    if (idKey) seen.add(idKey);

    const profile = profileIndex.get(nameKey) || profileIndex.get(idKey) || null;
    const entry = buildEntry(key, r, profile);

    map.set(key, entry);
    if (nameKey && nameKey !== key) map.set(nameKey, entry);
    if (idKey && idKey !== key) map.set(idKey, entry);
  });

  // Secondary: profiles not covered by roster (edge case: profile exists but device dropped)
  (profiles || []).forEach((profile) => {
    if (!profile?.id) return;
    const nameKey = normalize(profile.name || profile.displayName || '');
    const idKey = normalize(profile.id);
    const key = nameKey || idKey;
    if (seen.has(key)) return;
    seen.add(key);

    const entry = buildEntry(key, null, profile);
    map.set(key, entry);
    if (idKey && idKey !== key) map.set(idKey, entry);
  });

  return map;
}
