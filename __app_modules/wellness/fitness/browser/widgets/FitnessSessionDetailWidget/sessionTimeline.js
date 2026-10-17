import { buildPlaybackIntervals, projectPlaybackIntervals } from './playbackIntervals.js';
// One time axis and one list of vertical marks for the whole session-detail
// stack (rings chart · video gutter · heart-rate lanes).
//
// Each layer used to derive its own axis and its own copy of every mark, so one
// event was drawn two or three times — with differing colours, a different subset
// per layer, and only conventionally the same x. Now the pane computes both once:
// TimelineOverlay draws every mark full-height behind the stack, and the layers
// only place their own annotations (badges, video cards) from the same marks.
import { createChartDataSource } from "../FitnessChart/sessionDataAdapter.js";
import { CHART_MARGIN } from "../../lib/chartConstants.js";
import { getActivityDisplay, primaryActivity } from "../../lib/activities/fitnessActivityRegistry.js";
import { computeEffectiveTicks } from "./useTimelineMarkers.js";
import {
  computeRaceBands, computeSeamLines, computeVideoMarkers, computeChallengeMarkers,
  snapChallengeEndsToZoneTicks, withBadgeXs,
} from "./timelineOverlay.js";
import { resolveSessionStartMs, resolvePrimaryMediaKey } from "./sessionDetailUtils.js";

const DEFAULT_ACCENT = '#3ba776';
export const BADGE_RADIUS = 11;

/** The session's time axis: tick count, tick interval and origin. Width-free. */
export function buildSessionAxis(sessionData) {
  if (!sessionData) return null;
  const { getSeries, roster, timebase } = createChartDataSource(sessionData);
  const src = sessionData?.timeline ? sessionData : (sessionData?.session || sessionData);
  const intervalSeconds = Number(src?.timeline?.interval_seconds);
  const intervalMs = intervalSeconds > 0
    ? intervalSeconds * 1000
    : (Number(timebase?.intervalMs) > 0 ? Number(timebase.intervalMs) : 5000);
  return {
    effectiveTicks: computeEffectiveTicks(sessionData, getSeries, roster),
    intervalMs,
    sessionStartMs: resolveSessionStartMs(sessionData),
    getSeries,
    roster,
  };
}

/** Geometry for the timelineOverlay helpers at a given pane width. */
export function axisOpts(axis, width, primaryMediaKey) {
  return {
    intervalMs: axis.intervalMs,
    effectiveTicks: axis.effectiveTicks,
    plotWidth: Math.max(1, width - CHART_MARGIN.left - CHART_MARGIN.right),
    marginLeft: CHART_MARGIN.left,
    sessionStartMs: axis.sessionStartMs,
    primaryMediaKey,
  };
}

/**
 * Every vertical mark, in pane x-coordinates. `challenges` carry a collision-free
 * `badgeX` for the badge row; `accent` is the one colour race bands use everywhere.
 */
export function buildSessionMarks(sessionData, axis, width, primaryMediaKey) {
  if (!sessionData || !axis || !(width > 0)) return null;
  const opts = axisOpts(axis, width, primaryMediaKey ?? resolvePrimaryMediaKey(sessionData));
  const src = sessionData?.timeline ? sessionData : (sessionData?.session || sessionData);
  const events = src?.timeline?.events;
  const zoneSeriesByUser = {};
  for (const entry of axis.roster || []) {
    const userId = entry.id || entry.profileId;
    zoneSeriesByUser[userId] = axis.getSeries(userId, 'zone_id', { clone: false })
      || axis.getSeries(userId, 'zone', { clone: false }) || [];
  }
  const challenges = withBadgeXs(
    snapChallengeEndsToZoneTicks(computeChallengeMarkers(events, opts), zoneSeriesByUser, opts),
    {
      minGap: BADGE_RADIUS * 2 + 2,
      min: opts.marginLeft + BADGE_RADIUS,
      max: opts.marginLeft + opts.plotWidth - BADGE_RADIUS,
    }
  );
  return {
    bands: computeRaceBands(src?.activities, opts),
    seams: computeSeamLines(src?.seams, opts),
    challenges,
    videos: computeVideoMarkers(events, opts),
    playback: projectPlaybackIntervals(buildPlaybackIntervals(sessionData, axis), opts),
    accent: getActivityDisplay(primaryActivity(src?.activities)?.type)?.accent || DEFAULT_ACCENT,
  };
}
