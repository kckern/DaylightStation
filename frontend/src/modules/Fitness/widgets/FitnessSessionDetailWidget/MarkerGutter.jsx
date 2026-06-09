import React from 'react';
import { useTimelineMarkers } from './useTimelineMarkers.js';
import { getChallengeMarkerColor } from '@/modules/Fitness/lib/activities/challengeTypeRegistry.js';
import './MarkerGutter.scss';

/**
 * Center gutter between the line chart (top) and the HR-area lanes (bottom).
 *
 * It carries the vertical indicators THROUGH this band — challenge duration rectangles
 * (solid edge on the right = challenge end) and video-change dashed lines — so the
 * indicators read as one continuous cut across all three layers (line chart, gutter,
 * lanes). Video-change poster cards live here; challenge number badges live at the top
 * of the line chart. Same tick axis (useTimelineMarkers) keeps everything aligned.
 */
export default function MarkerGutter({ sessionData }) {
  const { ref, width, height, challengeMarkers, videoMarkers } = useTimelineMarkers(sessionData);

  return (
    <div ref={ref} className="marker-gutter">
      <svg className="marker-gutter__lines" width={width} height={height} aria-hidden="true">
        {challengeMarkers.map((m, i) => {
          const color = getChallengeMarkerColor(m);
          const w = Math.max(m.width, 2);
          return (
            <g key={`gl-chal-${i}`}>
              <rect x={m.x} y={0} width={w} height={height} fill={color} opacity={0.06} />
              <line x1={m.xEnd} y1={0} x2={m.xEnd} y2={height} stroke={color} strokeWidth={1.5} opacity={0.9} />
            </g>
          );
        })}
        {videoMarkers.map((m, i) => (
          <line key={`gl-vid-${i}`} x1={m.x} y1={0} x2={m.x} y2={height}
            stroke="rgba(255,255,255,0.8)" strokeWidth={1.5} strokeDasharray="6 4" />
        ))}
      </svg>
      {videoMarkers.map((m, i) => (
        <div key={`vid-${i}`} className="marker-gutter__chip marker-gutter__chip--video" style={{ left: `${m.x}px` }}>
          <div className="imgs">
            {m.posterUrl && <img className="poster" src={m.posterUrl} alt="" />}
            {m.thumbUrl && <img className="thumb" src={m.thumbUrl} alt="" />}
          </div>
          {m.episodeName && <div className="caption">{m.episodeName}</div>}
        </div>
      ))}
    </div>
  );
}
