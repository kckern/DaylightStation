import React from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import { useLeaderAnchoredZoom } from '@/modules/Fitness/lib/cycleGame/useLeaderAnchoredZoom.js';
import './PovGrid.scss';

/**
 * POV piston grid — the leader-anchored spatial standings as a vertical Tron road.
 * Reuses the horizontal piston math: useLeaderAnchoredZoom returns positions in
 * [0,1] (leader high). We map each to the vertical axis with topFrac = 1 − pos, so
 * the leader sits near the top (far, toward the vanishing point) and the trailer
 * near the bottom (near the camera). Same zoom/pan/rezoom rules — only the axis
 * changes. A CSS perspective skew (.cg-pov__plane) turns it into a 3-D road; the
 * metre gridlines double as the road's depth lines and pan/glide as the leader
 * advances. One lane column per rider; the tip avatar rides each lane at its depth.
 */
export default function PovGrid({ riderIds, riders, riderLive = {} }) {
  const distOf = (id) => Math.max(0, riders[id]?.cumulativeDistanceM || 0);
  const zoom = useLeaderAnchoredZoom(riderIds.map(distOf));
  const topOf = (id) => 1 - zoom.xForDist(distOf(id));
  const laneX = (idx) => riderIds.length <= 1 ? 50 : 12 + (idx * (76 / (riderIds.length - 1)));

  return (
    <div className="cg-pov" data-testid="race-pov">
      <div className="cg-pov__plane" data-testid="pov-road">
        <div className="cg-pov__grid" data-testid="pov-grid" aria-hidden="true">
          {zoom.lines.map((l) => (
            <div key={l.m} className="cg-pov__hline" style={{ top: `${((1 - l.x) * 100).toFixed(2)}%` }} />
          ))}
          {riderIds.map((id, idx) => (
            <div key={`v-${id}`} className="cg-pov__vline" style={{ left: `${laneX(idx)}%` }} />
          ))}
        </div>

        {riderIds.map((id, idx) => {
          const color = LINE_COLORS[idx % LINE_COLORS.length];
          const isGhost = !!riders[id]?.isGhost;
          const live = riderLive[id] || {};
          return (
            <div key={id} className={`cg-pov__marker${isGhost ? ' is-ghost' : ''}`}
              data-testid="pov-marker"
              style={{ top: `${(topOf(id) * 100).toFixed(2)}%`, left: `${laneX(idx)}%`, '--cg-pov-color': color }}>
              {(() => {
                const avatar = (
                  <CircularUserAvatar name={riders[id]?.displayName} avatarSrc={live.avatarSrc}
                    heartRate={live.heartRate} zoneId={live.zoneId} zoneColor={live.zoneColor || color}
                    size={44} showGauge={false} showIndicator={false} />
                );
                return isGhost ? <span className="cg-ghost">{avatar}</span> : avatar;
              })()}
              <span className="cg-pov__dist">{formatDistance(distOf(id))}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

PovGrid.propTypes = {
  riderIds: PropTypes.array.isRequired,
  riders: PropTypes.object.isRequired,
  riderLive: PropTypes.object
};
