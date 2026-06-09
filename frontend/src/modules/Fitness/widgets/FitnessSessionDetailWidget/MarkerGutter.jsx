import React from 'react';
import { useTimelineMarkers } from './useTimelineMarkers.js';
import { getChallengeTypeDisplay, getChallengeMarkerColor } from '@/modules/Fitness/lib/activities/challengeTypeRegistry.js';
import './MarkerGutter.scss';

/**
 * Center gutter between the line chart (top) and the HR-area lanes (bottom). It is the
 * single home for marker icons + labels; the vertical indicators (challenge duration
 * rectangles, video-change dashed lines) are drawn by the two charts so they appear to
 * emanate up and down from here. Chips are positioned on the SAME tick axis as those
 * indicators via useTimelineMarkers, so they line up with both charts.
 */
export default function MarkerGutter({ sessionData }) {
  const { ref, challengeMarkers, videoMarkers } = useTimelineMarkers(sessionData);

  return (
    <div ref={ref} className="marker-gutter">
      {challengeMarkers.map((m, i) => {
        const display = getChallengeTypeDisplay(m.type);
        const color = getChallengeMarkerColor(m);
        return (
          <div
            key={`chal-${i}`}
            className={`marker-gutter__chip marker-gutter__chip--challenge marker-gutter__chip--${m.result || 'unknown'}`}
            style={{ left: `${m.x}px`, '--marker-color': color }}
            title={m.label || display.label}
          >
            <span className="icon">{display.icon}</span>
            {m.type === 'zone' && m.label && <span className="zone">{m.label}</span>}
            {m.requiredCount != null && <span className="count">{m.requiredCount}</span>}
          </div>
        );
      })}
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
