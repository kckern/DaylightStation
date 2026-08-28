import React, { useMemo, useRef, useState, useLayoutEffect } from 'react';
import { createChartDataSource } from '../FitnessChart/sessionDataAdapter.js';
import { CHART_MARGIN, MARKER_FILL_OPACITY } from '@/modules/Fitness/lib/chartConstants.js';
import { computeRaceBands, computeSeamLines, computeVideoMarkers, computeChallengeMarkers, snapChallengeEndsToZoneTicks } from './timelineOverlay.js';
import { resolveSessionStartMs, resolvePrimaryMediaKey } from './sessionDetailUtils.js';
import { computeEffectiveTicks } from './useTimelineMarkers.js';
import { getChallengeMarkerColor } from '@/modules/Fitness/lib/activities/challengeTypeRegistry.js';
import { getActivityDisplay, primaryActivity } from '@/modules/Fitness/lib/activities/fitnessActivityRegistry.js';
import './FitnessTimeline.scss';

import { tickToX, buildHrAreaPath } from './hrAreaPath.js';

export default function FitnessTimeline({ sessionData, maxAvatarSize, primaryMediaKey }) {
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setDimensions({ width: Math.round(width), height: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { getSeries, roster, timebase } = useMemo(
    () => createChartDataSource(sessionData),
    [sessionData]
  );

  const { width, height } = dimensions;
  const plotWidth = width - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = height; // No bottom margin — chart above provides x-axis labels

  // Global effectiveTicks — shared with the gutter (useTimelineMarkers) so chips align.
  const effectiveTicks = useMemo(
    () => computeEffectiveTicks(sessionData, getSeries, roster),
    [roster, getSeries, sessionData]
  );

  const intervalMs = Number(timebase?.intervalMs) > 0 ? Number(timebase.intervalMs) : 5000;

  const overlay = useMemo(() => {
    const sessionStartMs = resolveSessionStartMs(sessionData);
    const opts = {
      intervalMs, effectiveTicks, plotWidth, marginLeft: CHART_MARGIN.left, sessionStartMs,
      primaryMediaKey: primaryMediaKey ?? resolvePrimaryMediaKey(sessionData)
    };
    const events = sessionData?.timeline?.events;
    const zoneSeriesByUser = {};
    for (const entry of roster || []) {
      const userId = entry.id || entry.profileId;
      zoneSeriesByUser[userId] = getSeries(userId, 'zone_id', { clone: false }) || getSeries(userId, 'zone', { clone: false }) || [];
    }
    return {
      bands: computeRaceBands(sessionData?.activities, opts),
      seams: computeSeamLines(sessionData?.seams, opts),
      videoMarkers: computeVideoMarkers(events, opts),
      challengeMarkers: snapChallengeEndsToZoneTicks(computeChallengeMarkers(events, opts), zoneSeriesByUser, opts),
      accent: getActivityDisplay(primaryActivity(sessionData?.activities)?.type)?.accent || '#3ba776',
    };
  }, [sessionData, intervalMs, effectiveTicks, plotWidth, getSeries, roster, primaryMediaKey]);

  const lanes = useMemo(() => {
    if (!roster || roster.length === 0 || plotWidth <= 0 || plotHeight <= 0) return [];

    const participantCount = roster.length;
    const laneGap = 2;
    const laneHeight = Math.max(10, (plotHeight - (participantCount - 1) * laneGap) / participantCount);

    return roster.map((entry, idx) => {
      const userId = entry.id || entry.profileId;
      const hrSeries = getSeries(userId, 'heart_rate', { clone: false });
      const zoneSeries = getSeries(userId, 'zone_id', { clone: false }) || getSeries(userId, 'zone', { clone: false });

      const laneTop = idx * (laneHeight + laneGap);
      const { fills, hrMax, lastActiveTick } = buildHrAreaPath(hrSeries, zoneSeries, effectiveTicks, plotWidth, laneTop, laneHeight, intervalMs);

      return {
        userId,
        name: entry.displayLabel || entry.name || userId,
        avatarUrl: entry.avatarUrl,
        isGuest: entry.isGuest === true,
        laneTop,
        laneHeight,
        fills,
        hrMax,
        lastActiveTick,
      };
    });
  }, [roster, getSeries, effectiveTicks, plotWidth, plotHeight, intervalMs]);

  // X-axis labels removed — the chart row above provides them

  if (!sessionData || width === 0) {
    return <div ref={containerRef} className="fitness-timeline" />;
  }

  return (
    <div ref={containerRef} className="fitness-timeline">
      <svg width={width} height={height} className="fitness-timeline__svg">
        <defs>
          {lanes.map((lane) => {
            const avatarSize = maxAvatarSize > 0 ? Math.min(lane.laneHeight, maxAvatarSize) : lane.laneHeight;
            const r = avatarSize / 2;
            const cx = r;
            const cy = lane.laneTop + lane.laneHeight / 2;
            return (
              <clipPath key={`clip-${lane.userId}`} id={`avatar-clip-${lane.userId}`}>
                <circle cx={cx} cy={cy} r={r} />
              </clipPath>
            );
          })}
        </defs>
        {/* race bands (under lanes) */}
        {overlay.bands.map((b, i) => (
          <g key={`band-${b.raceId || i}`} className="timeline-band">
            <rect x={b.x} y={0} width={b.width} height={plotHeight} fill={overlay.accent} opacity={0.1} />
            <rect x={b.x} y={0} width={b.width} height={2} fill={overlay.accent} opacity={0.6} />
          </g>
        ))}
        {/* HR-area fills (under the indicator overlays) */}
        {lanes.map((lane) => (
          <g key={`fills-${lane.userId}`}>
            {lane.fills.map((fill, i) => (
              <path key={i} d={fill.d} fill={fill.color} opacity={0.6} stroke="none" />
            ))}
          </g>
        ))}
        {/* group caption — parked in the empty right-margin strip (clear of lane fills + per-lane bpm labels) */}
        <text className="fitness-timeline__caption" x={width - 8} y={12} textAnchor="end">HEART RATE</text>
        {/* per-lane peak HR + early-stop marker */}
        {lanes.map((lane) => {
          const cy = lane.laneTop + lane.laneHeight / 2;
          const endX = tickToX(lane.lastActiveTick, effectiveTicks, plotWidth);
          const stoppedEarly = lane.lastActiveTick >= 0 && lane.lastActiveTick < effectiveTicks - 2;
          return (
            <g key={`lane-meta-${lane.userId}`}>
              {Number.isFinite(lane.hrMax) && (
                <text className="fitness-timeline__hr-max" x={lane.laneHeight + 8} y={lane.laneTop + 12}>
                  {Math.round(lane.hrMax)} bpm
                </text>
              )}
              {stoppedEarly && (
                <circle className="fitness-timeline__end-dot" cx={endX} cy={cy} r={3} />
              )}
            </g>
          );
        })}
        {/* challenge duration rectangles — solid edge on the RIGHT (challenge end) */}
        {overlay.challengeMarkers.map((m, i) => {
          const color = getChallengeMarkerColor(m);
          const w = Math.max(m.width, 2);
          return (
            <g key={`chal-${i}`} className="timeline-challenge-marker">
              <rect x={m.x} y={0} width={w} height={plotHeight} fill={color} opacity={MARKER_FILL_OPACITY} />
            </g>
          );
        })}
        {/* seams (dashed) */}
        {overlay.seams.map((s, i) => (
          <g key={`seam-${i}`} className="timeline-seam">
            <line x1={s.x} y1={0} x2={s.x} y2={plotHeight} stroke="rgba(255,255,255,0.55)" strokeWidth={1.5} strokeDasharray="3 3" />
          </g>
        ))}
        {/* avatars — drawn LAST so they sit above every indicator line/rect */}
        {lanes.map((lane) => {
          if (!lane.avatarUrl) return null;
          const size = maxAvatarSize > 0 ? Math.min(lane.laneHeight, maxAvatarSize) : lane.laneHeight;
          const r = size / 2;
          const borderWidth = 3;
          return (
            <g key={`avatar-${lane.userId}`}>
              <image
                href={lane.avatarUrl}
                x={0}
                y={lane.laneTop + (lane.laneHeight - size) / 2}
                width={size}
                height={size}
                clipPath={`url(#avatar-clip-${lane.userId})`}
                preserveAspectRatio="xMidYMid slice"
              />
              <circle
                cx={r}
                cy={lane.laneTop + lane.laneHeight / 2}
                r={r - borderWidth / 2}
                fill="none"
                stroke="rgba(0, 0, 0, 0.7)"
                strokeWidth={borderWidth}
              />
            </g>
          );
        })}
        {/* guest chips — small muted marker beside the avatar (audit N10) */}
        {lanes.map((lane) => {
          if (!lane.isGuest) return null;
          const size = maxAvatarSize > 0 ? Math.min(lane.laneHeight, maxAvatarSize) : lane.laneHeight;
          return (
            <text
              key={`guest-${lane.userId}`}
              className="fitness-timeline__guest-chip"
              x={size + 6}
              y={lane.laneTop + lane.laneHeight / 2}
              dominantBaseline="central"
            >
              guest
            </text>
          );
        })}
      </svg>
    </div>
  );
}
