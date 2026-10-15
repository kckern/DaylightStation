import React from 'react';
import { getChallengeMarkerColor } from "../../lib/activities/challengeTypeRegistry.js";
import { MARKER_FILL_OPACITY } from "../../lib/chartConstants.js";

/**
 * Every vertical mark of the session-detail stack, drawn once: one SVG behind the
 * rings chart, the video gutter and the heart-rate lanes, from the chart's plot
 * top to the bottom of the lanes. Marks come from buildSessionMarks (one axis),
 * so a race band, a seam, a challenge or a video change is a single object that
 * runs the full height — not a fragment per layer.
 *
 * Behind the layers (they are transparent), so lines, fills and avatars draw on
 * top of the marks. Badges and video cards stay in their layers as annotations,
 * placed from the same marks.
 */
export default function TimelineOverlay({ marks, width, top, height }) {
  if (!marks || !(width > 0) || !(height > 0)) return null;
  const { bands, seams, challenges, videos, accent } = marks;
  return (
    <svg
      className="session-detail__overlay"
      width={width}
      height={height}
      style={{ top }}
      aria-hidden="true"
    >
      {bands.map((b, i) => (
        <g key={`band-${b.raceId || i}`}>
          <rect x={b.x} y={0} width={b.width} height={height} fill={accent} opacity={0.1} />
          <rect x={b.x} y={0} width={b.width} height={2} fill={accent} opacity={0.55} />
        </g>
      ))}
      {challenges.map((m, i) => {
        const color = getChallengeMarkerColor(m);
        return (
          <g key={`chal-${i}`}>
            <rect x={m.x} y={0} width={Math.max(m.width, 2)} height={height} fill={color} opacity={MARKER_FILL_OPACITY} />
            {/* solid edge on the right = challenge end */}
            <line x1={m.xEnd} y1={0} x2={m.xEnd} y2={height} stroke={color} strokeWidth={1.5} opacity={0.8} />
          </g>
        );
      })}
      {seams.map((s, i) => (
        <line key={`seam-${i}`} x1={s.x} y1={0} x2={s.x} y2={height}
          stroke="rgba(255,255,255,0.55)" strokeWidth={1.5} strokeDasharray="3 3" />
      ))}
      {videos.map((v, i) => (
        <line key={`vid-${i}`} x1={v.x} y1={0} x2={v.x} y2={height}
          stroke="rgba(255,255,255,0.7)" strokeWidth={1.5} strokeDasharray="6 4" />
      ))}
    </svg>
  );
}
