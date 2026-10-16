// Session-detail header model. One shape, two sources:
//  - headerFromDetail: the full session (GET /sessions/:id), the authority;
//  - headerFromListRow: the row already loaded for the home sessions list, so a
//    tapped session's header renders at once while the detail loads.
// Both go through the same formatters, so the header does not change when the
// detail lands — only the parts the row cannot supply (recap video, Strava stats,
// the charts) arrive then.
import { formatFitnessDate } from "../../lib/dateFormatter.js";
import { getActivityDisplay, primaryActivity } from "../../lib/activities/fitnessActivityRegistry.js";
import { selectPrimaryMedia, buildSelectionConfig } from "../../hooks/fitness/selectPrimaryMedia.js";
import { mediaDisplayUrl, mediaIdentityKey } from "./sessionDetailUtils.js";
import { deriveRecap } from "./recapVideo.js";

export function formatTime(startTime, timezone) {
  if (!startTime) return '--';
  const opts = { hour: 'numeric', minute: '2-digit' };
  if (timezone) opts.timeZone = timezone;
  return new Date(startTime).toLocaleTimeString([], opts).toLowerCase().replace(' ', '');
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  return formatFitnessDate(dateStr + 'T12:00:00');
}

export function formatElapsed(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  const minutes = Math.max(1, Math.round(durationMs / 60000));
  if (minutes < 60) return `${minutes}m elapsed`;
  const remainder = minutes % 60;
  return `${Math.floor(minutes / 60)}h${remainder ? ` ${remainder}m` : ''} elapsed`;
}

export function measuredDurationMs(participant = {}) {
  if (Number.isFinite(participant.measuredDurationMs)) return participant.measuredDurationMs;
  return Object.values(participant.zone_minutes || participant.zoneMinutes || {})
    .reduce((total, value) => total + (Number(value) || 0), 0) * 60000;
}

export function headerFromDetail(sessionData, plexConfig) {
  if (!sessionData) return null;
  const summary = sessionData.summary || {};
  // Re-derive primary rather than trusting the stored `primary` flag — old
  // sessions carry a stale flag on the wrong item (a music track, or a brief
  // bleed-over episode from the previous session). selectPrimaryMedia filters
  // audio and keys on actual played time. Fall back to the flag, then media[0].
  const mediaList = Array.isArray(summary.media) ? summary.media : null;
  const pm = mediaList
    ? (selectPrimaryMedia(mediaList, buildSelectionConfig(plexConfig))
      || mediaList.find(m => m.primary)
      || mediaList[0])
    : null;
  const session = sessionData.session || {};

  const dateStr = sessionData.date
    || (sessionData.sessionId
      ? `${sessionData.sessionId.slice(0, 4)}-${sessionData.sessionId.slice(4, 6)}-${sessionData.sessionId.slice(6, 8)}`
      : null);

  // Group detail puts start/end/duration at the ROOT; normal sessions nest them under .session.
  const startMs = session.start ? new Date(session.start).getTime()
    : (sessionData.start != null ? new Date(sessionData.start).getTime()
      : (Number.isFinite(sessionData.startTime) ? sessionData.startTime : null));
  const endMs = Number.isFinite(sessionData.endTime) ? sessionData.endTime
    : (session.end ? new Date(session.end).getTime()
      : (sessionData.end ? new Date(sessionData.end).getTime() : null));
  const durationSec = session.duration_seconds ?? sessionData.duration_seconds ?? 0;
  const durationMs = durationSec * 1000;
  const elapsedMs = sessionData.elapsedMs || (startMs && endMs ? Math.max(0, endMs - startMs) : durationMs);

  // Extract max suffer score and first activityId across all participants
  const participants = sessionData.participants || {};
  const participantSummaries = summary.participants || {};
  let sufferScore = null;
  let stravaActivityId = null;
  for (const p of Object.values(participants)) {
    const ss = p.strava?.sufferScore;
    if (ss != null && (sufferScore === null || ss > sufferScore)) {
      sufferScore = ss;
      stravaActivityId = p.strava?.activityId || null;
    }
  }

  const stravaBlock = sessionData.strava || null;

  const act = !pm ? primaryActivity(sessionData?.activities) : null;
  const actDisplay = act ? getActivityDisplay(act.type) : null;
  // Prefer the show/video over the generic Strava activity name when the
  // episode title is absent.
  const title = pm?.title || pm?.showTitle || pm?.grandparentTitle || stravaBlock?.name || (actDisplay ? actDisplay.label(act.count) : 'Workout');

  // Elapsed length for deriving an older recap's speedup. When start and end are
  // both the stored local-time strings, their difference cancels the browser's
  // timezone (it parses them as local); mixing a string with an epoch would not.
  const recapDurationMs = (session.start && session.end)
    ? new Date(session.end).getTime() - new Date(session.start).getTime()
    : (startMs && endMs ? endMs - startMs : null);
  const recap = deriveRecap(sessionData.timelapse, recapDurationMs);

  return {
    title,
    // Identity of the video the header shows — the overlay layers leave this one
    // out of the marker gutter, so they must agree on it with the header.
    primaryMediaKey: pm ? mediaIdentityKey(pm) : null,
    activityPoster: actDisplay?.Poster || null,
    activityAccent: actDisplay?.accent || null,
    showTitle: pm?.showTitle || pm?.grandparentTitle || null,
    grandparentId: pm?.grandparentId || null,
    posterUrl: pm?.grandparentId ? mediaDisplayUrl(pm.grandparentId) : null,
    thumbUrl: pm?.contentId ? mediaDisplayUrl(pm.contentId) : null,
    recapUrl: recap.url,
    recapSpeedup: recap.speedup,
    hasRecap: recap.ready,
    recapProcessing: recap.processing,
    description: pm?.description || null,
    date: dateStr ? formatDate(dateStr) : '',
    time: startMs ? formatTime(startMs, sessionData.timezone) : null,
    endTime: endMs ? formatTime(endMs, sessionData.timezone) : null,
    elapsedLabel: formatElapsed(elapsedMs),
    isGroup: !!sessionData.isGroup,
    raceCount: act?.count || 0,
    segmentCount: Array.isArray(sessionData.segments) ? sessionData.segments.length : 0,
    riders: [...new Set([...Object.keys(participants), ...Object.keys(participantSummaries)])].map((id) => ({
      id,
      name: participants[id]?.displayName || participants[id]?.display_name || id,
      measuredDurationMs: measuredDurationMs(participants[id]) || measuredDurationMs(participantSummaries[id]),
    })),
    elapsedMs,
    totalRings: sessionData.treasureBox?.totalRings || summary.rings?.total || sessionData.totalRings || 0,
    sufferScore,
    stravaActivityId,
    voiceMemos: Array.isArray(summary.voiceMemos) ? summary.voiceMemos.filter(m => m.transcript) : [],
    stravaNotes: sessionData.strava_notes?.text || sessionData.stravaNotes || null,
    stravaType: stravaBlock?.type || null,
    stravaHasMap: !!(stravaBlock?.map?.polyline),
  };
}

/**
 * The same header from a home-list row. Fields the row does not carry are left
 * in the "not known yet" state the renderer treats as pending: no recap video
 * (`hasRecap` false, so the thumb shows its still image — the recap's poster),
 * and `pendingStrava` when the right box would need Strava stats the row lacks.
 */
export function headerFromListRow(row) {
  if (!row) return null;
  const pm = row.media?.primary || null;
  const act = !pm ? primaryActivity(row.activities) : null;
  const actDisplay = act ? getActivityDisplay(act.type) : null;
  const strava = row.strava || null;
  const title = pm?.title || pm?.showTitle || pm?.grandparentTitle || strava?.name || (actDisplay ? actDisplay.label(act.count) : 'Workout');
  const startMs = Number.isFinite(row.startTime) ? row.startTime : null;
  const elapsedMs = row.elapsedMs ?? row.durationMs;
  const endMs = Number.isFinite(row.endTime) ? row.endTime
    : (startMs && Number.isFinite(elapsedMs) ? startMs + elapsedMs : null);
  const participants = row.participants || {};
  return {
    title,
    primaryMediaKey: pm ? mediaIdentityKey(pm) : null,
    activityPoster: actDisplay?.Poster || null,
    activityAccent: actDisplay?.accent || null,
    showTitle: pm?.showTitle || pm?.grandparentTitle || null,
    grandparentId: pm?.grandparentId || null,
    posterUrl: pm?.grandparentId ? mediaDisplayUrl(pm.grandparentId) : null,
    thumbUrl: pm?.contentId ? mediaDisplayUrl(pm.contentId) : null,
    recapUrl: null,
    hasRecap: false,
    recapProcessing: false,
    description: pm?.description || null,
    date: row.date ? formatDate(row.date) : '',
    time: startMs ? formatTime(startMs, row.timezone) : null,
    endTime: endMs ? formatTime(endMs, row.timezone) : null,
    elapsedLabel: formatElapsed(elapsedMs),
    isGroup: !!row.isGroup,
    raceCount: act?.count || 0,
    segmentCount: Array.isArray(row.segments) ? row.segments.length : 0,
    riders: Object.keys(participants).map((id) => ({
      id,
      name: participants[id]?.displayName || participants[id]?.display_name || id,
      measuredDurationMs: measuredDurationMs(participants[id]),
    })),
    elapsedMs,
    totalRings: row.totalRings || 0,
    sufferScore: Number.isFinite(row.maxSufferScore) ? row.maxSufferScore : null,
    stravaActivityId: row.stravaActivityId || null,
    voiceMemos: Array.isArray(row.voiceMemos) ? row.voiceMemos.filter((m) => m.transcript) : [],
    stravaNotes: row.stravaNotes || null,
    stravaType: strava?.type || null,
    stravaHasMap: !!(strava?.hasMap || strava?.mapPolyline),
    // The Strava stats box needs moving time / max HR / elevation gain, which the
    // row does not carry: hold that box as pending rather than fill it twice.
    pendingStrava: !pm?.contentId && !!strava,
    preview: true,
  };
}

const MEDIA_FIELDS = ['title', 'showTitle', 'grandparentId', 'posterUrl', 'thumbUrl', 'description', 'primaryMediaKey', 'activityPoster', 'activityAccent'];

/**
 * The detail is the authority wherever it has data; the list row fills only its
 * gaps. A merged group detail carries no media, memos or suffer score (it showed
 * "Workout" and a generic poster where the list showed "Split Strength", its
 * poster and two memos) — and with the header pre-rendered from the row, taking
 * the detail as-is would swap a right header for a worse one on hydration.
 */
export function mergeHeaders(detail, row) {
  if (!detail) return row || null;
  if (!row) return detail;
  const merged = { ...detail };
  const detailHasMedia = !!(detail.showTitle || detail.posterUrl || detail.thumbUrl);
  const rowHasMedia = !!(row.showTitle || row.posterUrl || row.thumbUrl);
  if (!detailHasMedia && rowHasMedia) {
    for (const k of MEDIA_FIELDS) merged[k] = row[k];
  }
  if (!(detail.voiceMemos?.length) && row.voiceMemos?.length) merged.voiceMemos = row.voiceMemos;
  if (!detail.stravaNotes && row.stravaNotes) merged.stravaNotes = row.stravaNotes;
  if (detail.sufferScore == null && row.sufferScore != null) merged.sufferScore = row.sufferScore;
  if (!detail.stravaActivityId && row.stravaActivityId) merged.stravaActivityId = row.stravaActivityId;
  if (!(detail.totalRings > 0) && row.totalRings > 0) merged.totalRings = row.totalRings;
  return merged;
}
