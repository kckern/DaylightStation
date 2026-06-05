import React from 'react';
import PropTypes from 'prop-types';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import { useLeaderAnchoredZoom } from '@/modules/Fitness/lib/cycleGame/useLeaderAnchoredZoom.js';
import './CameraZoom.scss';

/**
 * CameraZoom — a transient "broadcast camera" panel the race director promotes into
 * the focus zone during lapping / photo-finish moments. Uses the same leader-anchored
 * spatial zoom as the piston chart: 1st place pinned near the right, the rest placed by
 * their true metric gap behind, the view rezooming (gliding) to keep the field framed.
 * A fixed-metre grid behind the markers makes the scale legible (density = zoom level);
 * a connector between the extremes carries the gap label. Pure presentational component.
 */
export default function CameraZoom({ riderIds, riders, riderLive = {} }) {
  const distOf = (id) => riders[id]?.cumulativeDistanceM || 0;
  const zoom = useLeaderAnchoredZoom(riderIds.map(distOf));
  const xOf = (id) => zoom.xForDist(distOf(id));

  // Extremes for the gap connector line (trailing → leading).
  const sorted = [...riderIds].sort((a, b) => distOf(a) - distOf(b));
  const leftId = sorted[0];
  const rightId = sorted[sorted.length - 1];
  const xl = xOf(leftId);
  const xr = xOf(rightId);
  const showConnector = riderIds.length >= 2 && xr > xl;
  const gapM = Math.abs(distOf(rightId) - distOf(leftId));

  return (
    <div className="cg-camera-zoom" data-testid="camera-zoom">
      {/* Fixed-metre grid backdrop — pans as the leader advances, re-spaces (glides) on
          a rezoom. Density reads the current zoom level. */}
      <div className="cg-camera-zoom__grid" data-testid="camera-grid" aria-hidden="true">
        {zoom.lines.map((l) => (
          <div key={l.m} className="cg-camera-zoom__gridline" style={{ left: `${(l.x * 100).toFixed(2)}%` }} />
        ))}
      </div>

      <div className="cg-camera-zoom__field">
        {showConnector && (
          <div
            className="cg-camera-zoom__connector"
            aria-hidden="true"
            style={{ left: `${(xl * 100).toFixed(2)}%`, width: `${((xr - xl) * 100).toFixed(2)}%` }}
          >
            <span className="cg-camera-zoom__gaplabel">{formatDistance(gapM)}</span>
          </div>
        )}

        {riderIds.map((id, idx) => {
          const rider = riders[id] || {};
          const color = LINE_COLORS[idx % LINE_COLORS.length];
          const isGhost = !!rider.isGhost;
          const initial = (rider.displayName || id || '?').trim().charAt(0).toUpperCase() || '?';
          return (
            <div
              key={`camera-marker-${id}`}
              className={`cg-camera-zoom__marker${isGhost ? ' cg-camera-zoom__marker--ghost' : ''}`}
              data-testid="camera-marker"
              style={{ left: `${(xOf(id) * 100).toFixed(2)}%`, '--cg-marker-color': color }}
            >
              <span className="cg-camera-zoom__avatar">{initial}</span>
              <span className="cg-camera-zoom__label">{formatDistance(distOf(id))}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

CameraZoom.propTypes = {
  riderIds: PropTypes.array.isRequired,
  riders: PropTypes.object.isRequired,
  riderLive: PropTypes.object
};
