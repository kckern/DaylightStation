import { DaylightMediaPath } from '../../lib/api.mjs';

/**
 * Builds a display-ready map of participants from ZoneProfileStore + roster.
 * Single source of truth for "how to render a participant."
 * Exported for testability — used in FitnessContext via useMemo.
 *
 * @param {Array} profiles - From ZoneProfileStore.getProfiles()
 * @param {Array} roster - Session roster with avatar/metadata
 * @returns {Map<string, DisplayEntry>} Normalized name → display entry
 */
export function buildParticipantDisplayMap(profiles, roster) {
  const map = new Map();
  const normalize = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

  const rosterIndex = new Map();
  (roster || []).forEach((r) => {
    const key = normalize(r?.name || r?.id || '');
    if (key) rosterIndex.set(key, r);
  });

  (profiles || []).forEach((profile) => {
    if (!profile?.id) return;
    const nameKey = normalize(profile.name || profile.displayName || '');
    const idKey = normalize(profile.id);
    const key = nameKey || idKey;
    const rosterEntry = rosterIndex.get(nameKey)
      || rosterIndex.get(idKey);
    const resolvedProfileId = profile.profileId || profile.id;
    const rawAvatar = rosterEntry?.avatarUrl
      || (resolvedProfileId ? `/static/img/users/${resolvedProfileId}` : '/static/img/users/user');
    const avatarSrc = DaylightMediaPath(rawAvatar);

    const entry = {
      id: profile.id,
      displayName: profile.displayName || profile.name || profile.id,
      avatarSrc,
      heartRate: profile.heartRate ?? null,
      zoneId: profile.currentZoneId || null,
      zoneName: profile.currentZoneName || null,
      zoneColor: profile.currentZoneColor || null,
      progress: profile.progress ?? null,
      targetHeartRate: profile.targetHeartRate ?? null,
      zoneSequence: profile.zoneSequence || [],
      groupLabel: profile.groupLabel || null,
      source: profile.source || null,
      updatedAt: profile.updatedAt || null
    };
    map.set(key, entry);
    // Also index by normalized ID so governance engine lookups by ID work
    if (idKey && idKey !== key) {
      map.set(idKey, entry);
    }
  });

  return map;
}
