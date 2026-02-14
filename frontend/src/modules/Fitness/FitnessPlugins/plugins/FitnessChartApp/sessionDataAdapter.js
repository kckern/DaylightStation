import { DaylightMediaPath } from '../../../../../lib/api.mjs';
import { getZoneColor } from '../../../domain';

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
 * Transform a session API response into the data interface
 * that FitnessChartApp's chart hooks expect.
 *
 * @param {Object} session - Response from GET /api/v1/fitness/sessions/:id
 * @returns {{ getSeries: Function, roster: Object[], timebase: Object }}
 */
export function createChartDataSource(session) {
  if (!session) return { getSeries: () => [], roster: [], timebase: {} };

  const timelineParticipants = session.timeline?.participants || {};

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
  const participantsMeta = session.participants || {};
  const legacyRoster = session.roster || [];

  let roster;
  if (Object.keys(participantsMeta).length > 0) {
    // V3 format: participants is an object keyed by userId
    roster = Object.entries(participantsMeta).map(([userId, meta]) => ({
      id: userId,
      profileId: userId,
      name: meta.display_name || userId,
      displayLabel: meta.display_name || userId,
      isActive: true, // completed session — everyone shown as present
      zoneColor: getZoneColor(getLastZone(userId)),
      avatarUrl: DaylightMediaPath(`/static/img/users/${userId}`),
      isPrimary: meta.is_primary || false,
      hrDeviceId: meta.hr_device || null,
    }));
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
