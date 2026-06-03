import React from 'react';
import PropTypes from 'prop-types';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import './CameraZoom.scss';

/**
 * Pure framing helper: normalize the framed riders' distances to 0..100% so the
 * broadcast camera auto-fills the frame on whatever cluster the director is
 * promoting (a lapping pair, a photo finish). The trailing rider pins to the
 * left edge (0%), the leader to the right (100%). When every distance is equal
 * (e.g. a dead heat or a single rider) there is no spread, so everyone centers
 * at 50% — this also guards against divide-by-zero.
 */
export function framePositions(riders) {
  const ds = riders.map((r) => r.distanceM || 0);
  const min = Math.min(...ds), max = Math.max(...ds);
  const range = max - min;
  return riders.map((r) => ({
    id: r.id,
    xPct: range > 0 ? (((r.distanceM || 0) - min) / range) * 100 : 50
  }));
}

/**
 * CameraZoom — a transient "broadcast camera" panel the race director promotes
 * into the focus zone during lapping / photo-finish moments. Auto-frames the
 * riders by normalizing their distances across the panel width (framePositions),
 * over a drifting neon grid that implies camera motion. Lane-colored markers glow
 * and slide as the gap closes; a thin connector line between the two extremes
 * emphasizes the distance being decided. Pure presentational component.
 */
export default function CameraZoom({ riderIds, riders, riderLive = {} }) {
  const framed = framePositions(
    riderIds.map((id) => ({ id, distanceM: riders[id].cumulativeDistanceM || 0 }))
  );

  // Extremes for the gap connector line (trailing → leading).
  const sorted = [...framed].sort((a, b) => a.xPct - b.xPct);
  const left = sorted[0];
  const right = sorted[sorted.length - 1];
  const showConnector = framed.length >= 2 && right.xPct > left.xPct;

  return (
    <div className="cg-camera-zoom" data-testid="camera-zoom">
      {/* Drifting perspective grid backdrop — implies a panning broadcast camera. */}
      <div className="cg-camera-zoom__grid" data-testid="camera-grid" aria-hidden="true" />

      <div className="cg-camera-zoom__field">
        {showConnector && (
          <div
            className="cg-camera-zoom__connector"
            aria-hidden="true"
            style={{ left: `${left.xPct}%`, width: `${right.xPct - left.xPct}%` }}
          />
        )}

        {framed.map((p, idx) => {
          const id = p.id;
          const rider = riders[id] || {};
          const color = LINE_COLORS[riderIds.indexOf(id) % LINE_COLORS.length] || LINE_COLORS[idx % LINE_COLORS.length];
          const isGhost = !!rider.isGhost;
          const initial = (rider.displayName || id || '?').trim().charAt(0).toUpperCase() || '?';
          const distanceM = rider.cumulativeDistanceM || 0;
          return (
            <div
              key={`camera-marker-${id}`}
              className={`cg-camera-zoom__marker${isGhost ? ' cg-camera-zoom__marker--ghost' : ''}`}
              data-testid="camera-marker"
              style={{ left: `${p.xPct}%`, '--cg-marker-color': color }}
            >
              <span className="cg-camera-zoom__avatar">{initial}</span>
              <span className="cg-camera-zoom__label">{formatDistance(distanceM)}</span>
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
