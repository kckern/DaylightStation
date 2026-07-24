import { DaylightMediaPath } from '@/lib/api.mjs';
import { getZoneColor } from '@/modules/Fitness/domain';
import { lookupUserName } from '@/modules/Fitness/player/overlays/lookupUserName.js';
import { genericGuestImageId, isGenericGuestProfileId } from '@/modules/Fitness/lib/guestPlaceholders.js';

/**
 * Key mapping: API short keys -> chart metric keys
 */
const METRIC_KEY_MAP = {
  heart_rate: 'hr',
  zone_id: 'zone',
  coins_total: 'coins',
  heart_beats: 'beats',
};

/**
 * Reverse of ZONE_SYMBOL_MAP from PersistenceManager:
 * Persistence abbreviates zone names when writing (cool→c, active→a, etc.)
 * We expand them back so getZoneColor() can resolve colors.
 */
const ZONE_ABBREV_MAP = { r: 'rest', c: 'cool', a: 'active', w: 'warm', h: 'hot', f: 'fire' };

/**
 * `guest_profile` is persisted either as a bare age-class string ('kid') or as an
 * object carrying one. Normalize both to the string `genericGuestImageId` wants.
 *
 * @returns {string|undefined}
 */
function guestAgeClass(guestProfile) {
  if (typeof guestProfile === 'string') return guestProfile;
  return guestProfile?.ageClass || guestProfile?.age_class;
}

/**
 * Resolve a roster row's display name.
 *
 * Sessions persist `participants.<slug>.display_name` as the bare slug for most
 * riders (`kckern: display_name: kckern`), so the stored value is only useful
 * when it differs from the slug. Precedence:
 *   1. configured users SSOT  — the only source of a real name ("KC Kern")
 *   2. stored display_name    — when it's a real name, not an echo of the slug
 *   3. "Guest"                — anonymous guests, rather than "Guest_<id>"
 *   4. title-cased slug       — last resort, preserves the previous behavior
 *
 * @returns {string}
 */
function resolveRosterName(userId, meta, configuredUsers, isGuest, guestProfile) {
  const configured = lookupUserName(configuredUsers, userId);
  if (configured && configured !== userId) return configured;

  const stored = (meta.displayName || meta.display_name || '').toString().trim();
  if (stored && stored.toLowerCase() !== String(userId).toLowerCase()) return stored;

  if (isGuest) {
    const guestName = (guestProfile?.name || guestProfile?.displayName || '').toString().trim();
    return guestName || 'Guest';
  }

  return userId.charAt(0).toUpperCase() + userId.slice(1);
}

/**
 * Transform a session API response into the data interface
 * that FitnessChart's chart hooks expect.
 *
 * @param {Object} session - Response from GET /api/v1/fitness/sessions/:id
 * @param {Object} [options]
 * @param {Array} [options.configuredUsers] - `userCollections.all` SSOT, each
 *   `{ id, name, groupLabel }`. Sessions persist `display_name` as the bare slug
 *   for most riders, so this is the only source of a real name ("KC Kern" for
 *   `kckern`); without it the roster can only title-case the slug ("Kckern").
 * @returns {{ getSeries: Function, roster: Object[], timebase: Object }}
 */
export function createChartDataSource(session, { configuredUsers = [] } = {}) {
  if (!session) return { getSeries: () => [], roster: [], timebase: {} };

  // Build per-user timeline data from either format:
  //   V1: timeline.participants = { userId: { hr: [...], zone: [...] } }
  //   V2: timeline.series = { "userId:metric": [...], ... } (flat keys)
  let timelineParticipants = session.timeline?.participants || {};
  if (Object.keys(timelineParticipants).length === 0 && session.timeline?.series) {
    const grouped = {};
    const CHART_METRICS = new Set(['hr', 'zone', 'coins', 'beats']);
    for (const [key, values] of Object.entries(session.timeline.series)) {
      const colonIdx = key.lastIndexOf(':');
      if (colonIdx === -1) continue;
      const userId = key.slice(0, colonIdx);
      const metric = key.slice(colonIdx + 1);
      if (!CHART_METRICS.has(metric)) continue;
      if (!grouped[userId]) grouped[userId] = {};
      // Expand abbreviated zone IDs back to full names for getZoneColor()
      if (metric === 'zone' && Array.isArray(values)) {
        grouped[userId][metric] = values.map(v =>
          v != null ? (ZONE_ABBREV_MAP[v] || v) : v
        );
      } else {
        grouped[userId][metric] = values;
      }
    }
    timelineParticipants = grouped;
  }

  const getLastZone = (userId) => {
    const series = timelineParticipants[userId]?.zone;
    if (!Array.isArray(series) || series.length === 0) return null;
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i] != null) return series[i];
    }
    return null;
  };

  // --- getSeries(userId, metric, options) ---
  // Called with chart keys (e.g. 'heart_rate'), maps to API short keys (e.g. 'hr')
  const getSeries = (userId, metric, options = {}) => {
    const shortKey = METRIC_KEY_MAP[metric] || metric;
    const participantTimeline = timelineParticipants[userId];
    if (!participantTimeline) return [];
    const series = participantTimeline[shortKey];
    if (!Array.isArray(series)) return [];
    return options.clone !== false ? [...series] : series;
  };

  // --- roster ---
  // Merge participants metadata with users discovered from timeline series
  const participantsMeta = session.participants || {};
  const legacyRoster = session.roster || [];

  // Collect all user IDs from both sources
  const allUserIds = new Set([
    ...Object.keys(participantsMeta),
    ...Object.keys(timelineParticipants),
  ]);

  let roster;
  if (allUserIds.size > 0) {
    roster = [...allUserIds]
      .filter(id => id !== 'global' && !id.startsWith('device:') && !id.startsWith('bike:'))
      .map(userId => {
      const meta = participantsMeta[userId] || {};
      const guestProfile = meta.guest_profile || meta.guestProfile || null;
      // A `guest_*` slug is the reliable guest signal — sessions don't always
      // persist an `is_guest` flag alongside it.
      const isGuest = meta.is_guest || meta.isGuest || isGenericGuestProfileId(userId);
      const displayName = resolveRosterName(userId, meta, configuredUsers, isGuest, guestProfile);
      // Guests have no per-person avatar asset; point at the shared placeholder
      // tier instead of `/users/guest_<id>`, which 404s into a broken image.
      const avatarId = isGuest ? genericGuestImageId(guestAgeClass(guestProfile)) : userId;
      return {
        id: userId,
        profileId: userId,
        name: displayName,
        displayLabel: displayName,
        isActive: true,
        zoneColor: getZoneColor(getLastZone(userId)),
        avatarUrl: DaylightMediaPath(`/static/img/users/${avatarId}`),
        isPrimary: meta.is_primary || meta.isPrimary || false,
        isGuest,
        guestProfile,
        hrDeviceId: meta.hr_device || meta.hrDevice || null,
      };
    });
  } else {
    // Legacy format: roster is an array
    roster = legacyRoster.map((entry, idx) => {
      const userId = entry.name || entry.hrDeviceId || `anon-${idx}`;
      return {
        id: userId,
        profileId: userId,
        name: entry.name || 'Unknown',
        displayLabel: entry.name || 'Unknown',
        isActive: true,
        zoneColor: getZoneColor(getLastZone(userId)),
        avatarUrl: DaylightMediaPath(`/static/img/users/${userId}`),
        isPrimary: entry.isPrimary || false,
        isGuest: false,
        guestProfile: null,
        hrDeviceId: entry.hrDeviceId || null,
      };
    });
  }

  // --- timebase ---
  const intervalSeconds = session.timeline?.interval_seconds || 5;
  const timebase = {
    intervalMs: intervalSeconds * 1000,
    tickCount: session.timeline?.tick_count || 0,
  };

  return { getSeries, roster, timebase };
}
