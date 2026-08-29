import moment from 'moment-timezone';
import { decodeSingleSeries } from '#domains/fitness/services/TimelineService.mjs';
import {
  computeParticipantStats, computeHrHistogram, ringsPerMinute,
  normalizeSessionEvents, dedupeChallengeEvents, discoverParticipants, zoneIntensity,
} from '#domains/fitness/services/SessionStatsService.mjs';
import { readRingSeries } from '#domains/fitness/services/ringSeries.mjs';

function downsampleZones(zones, targetRows) {
  if (!zones || zones.length <= targetRows) return zones || [];
  const windowSize = Math.max(1, Math.ceil(zones.length / targetRows));
  const result = [];
  for (let i = 0; i < zones.length; i += windowSize) {
    let best = null;
    for (const zone of zones.slice(i, i + windowSize)) {
      if (zone != null && (best == null || zoneIntensity(zone) > zoneIntensity(best))) best = zone;
    }
    result.push(best);
  }
  return result;
}

/** Convert persisted session schemas into a complete receipt presentation model. */
export function prepareFitnessReceiptPresentation(data, {
  resolveDisplayName = null, targetRows, zoneSymbolMap, eventSymbols, histogramBuckets,
} = {}) {
  if (!data) return null;
  const sessionInfo = data.session || {};
  const participants = data.participants || {};
  const timeline = data.timeline || {};
  const treasureBox = data.treasureBox || data.totals || null;
  const tz = data.timezone || sessionInfo.timezone || 'UTC';
  const intervalSeconds = timeline.interval_seconds || 5;
  const tickCount = timeline.tick_count || 0;
  const series = timeline.series || {};
  const timelineParticipants = timeline.participants || {};
  const participantSlugs = discoverParticipants(series, participants);
  const decoded = {};
  for (const slug of participantSlugs) {
    const rawZone = series[`${slug}:zone`] || timelineParticipants[slug]?.zone;
    const rawHr = series[`${slug}:hr`] || timelineParticipants[slug]?.hr;
    const flatRings = readRingSeries(series, slug);
    const rawRings = flatRings.length ? flatRings : timelineParticipants[slug]?.rings;
    const zoneArr = decodeSingleSeries(rawZone) || (Array.isArray(rawZone) ? rawZone : []);
    decoded[slug] = {
      zones: zoneArr.map((zone) => zone != null ? (zoneSymbolMap[zone] || zone) : null),
      hr: decodeSingleSeries(rawHr) || (Array.isArray(rawHr) ? rawHr : []),
      rings: decodeSingleSeries(rawRings) || (Array.isArray(rawRings) ? rawRings : []),
    };
  }
  const stats = {};
  for (const slug of participantSlugs) {
    const participant = participants[slug] || {};
    const samples = decoded[slug] || { zones: [], hr: [], rings: [] };
    const computed = computeParticipantStats({ ...samples, intervalSeconds, participant });
    stats[slug] = {
      displayName: participant.display_name || resolveDisplayName?.(slug) || slug,
      ...computed,
      ringsPerMinute: ringsPerMinute(computed.totalRings, computed.activeSeconds > 0 ? computed.activeSeconds / 60 : 0),
      hrHistogram: computeHrHistogram(samples.hr, samples.zones, { buckets: histogramBuckets }),
    };
  }
  const dsZones = Object.fromEntries(participantSlugs.map((slug) => [slug,
    downsampleZones(decoded[slug].zones, targetRows)]));
  const chartRows = participantSlugs.length ? Math.max(...participantSlugs.map((slug) => dsZones[slug].length)) : 0;
  const ticksPerRow = tickCount > 0 && chartRows > 0 ? tickCount / chartRows : 1;
  const sessionStart = sessionInfo.start ? moment.tz(sessionInfo.start, tz) : null;
  const chartEvents = normalizeSessionEvents(data).flatMap(({ type, event }) => {
    const eventTime = event.at || event.timestamp;
    if (!eventTime || !sessionStart) return [];
    const offsetSeconds = moment.tz(eventTime, tz).diff(sessionStart, 'seconds');
    const tickIndex = Math.max(0, Math.floor(offsetSeconds / intervalSeconds));
    return [{
      rowIndex: Math.min(chartRows - 1, Math.max(0, Math.floor(tickIndex / ticksPerRow))),
      type, symbol: eventSymbols[type] || '\u25CF',
      label: event.title || event.name || event.challenge_name || type,
      event,
    }];
  }).sort((a, b) => a.rowIndex - b.rowIndex);
  const tbRings = treasureBox?.totalRings ?? treasureBox?.rings ?? 0;
  return {
    sessionInfo, tz, intervalSeconds, participantSlugs, decoded, stats, dsZones,
    chartRows, ticksPerRow, chartEvents, tbRings, tbBuckets: treasureBox?.buckets || {},
    hasTreasureBox: tbRings > 0,
    leaderboard: participantSlugs.map((slug) => ({ slug, ...stats[slug] })).sort((a, b) => b.totalRings - a.totalRings),
    challenges: dedupeChallengeEvents(chartEvents),
    media: chartEvents.filter((event) => event.type === 'media'),
    voiceMemos: chartEvents.filter((event) => event.type === 'voice_memo'),
  };
}

export default prepareFitnessReceiptPresentation;
