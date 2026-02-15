import { DaylightMediaPath } from '@/lib/api.mjs';
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
 * Reverse of ZONE_SYMBOL_MAP from PersistenceManager:
 * Persistence abbreviates zone names when writing (cool→c, active→a, etc.)
 * We expand them back so getZoneColor() can resolve colors.
 */
const ZONE_ABBREV_MAP = { r: 'rest', c: 'cool', a: 'active', w: 'warm', h: 'hot', f: 'fire' };

/**
 * Transform a session API response into the data interface
 * that FitnessChartApp's chart hooks expect.
 *
 * @param {Object} session - Response from GET /api/v1/fitness/sessions/:id
 * @returns {{ getSeries: Function, roster: Object[], timebase: Object }}
 */
export function createChartDataSource(session) {
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
    roster = [...allUserIds].map(userId => {
      const meta = participantsMeta[userId] || {};
      return {
        id: userId,
        profileId: userId,
        name: meta.display_name || userId,
        displayLabel: meta.display_name || userId,
        isActive: true,
        zoneColor: getZoneColor(getLastZone(userId)),
        avatarUrl: DaylightMediaPath(`/static/img/users/${userId}`),
        isPrimary: meta.is_primary || false,
        hrDeviceId: meta.hr_device || null,
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
