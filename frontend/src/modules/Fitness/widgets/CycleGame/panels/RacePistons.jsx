import React from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import { useLeaderAnchoredZoom } from '@/modules/Fitness/lib/cycleGame/useLeaderAnchoredZoom.js';
import './RacePistons.scss';

/**
 * "Piston" race chart — a stacked one-dimensional standings view in a LEADER-ANCHORED
 * spatial window. The 1st-place rider is pinned near the right; every other rider sits
 * at its true metric gap behind, mapped through a held zoom (see useLeaderAnchoredZoom),
 * so falling behind visibly slides you left and gaining pulls you right. When the last
 * rider drifts out of the zoom band the view rezooms (glides) to re-frame the field.
 *
 * A fixed-metre grid behind the lanes makes the scale legible (density = zoom level).
 * Between vertically-adjacent lanes a connector segment carries a centered "X m" label —
 * the metric gap between those two riders. Lanes keep a stable vertical order. Pure
 * presentational; the bar + tip avatar glide (CSS transition) as positions change.
 */
export default function RacePistons({ riderIds, riders, riderLive = {} }) {
  const distOf = (id) => Math.max(0, riders[id]?.cumulativeDistanceM || 0);
  const zoom = useLeaderAnchoredZoom(riderIds.map(distOf));
  const xOf = (id) => zoom.xForDist(distOf(id));
  // Rank for the leader flag (furthest = 1st) without reordering the lanes.
  const ranked = [...riderIds].sort((a, b) => distOf(b) - distOf(a));

  return (
    <div className="cg-pistons" data-testid="race-pistons">
      {/* Fixed-metre grid backdrop — pans as the leader advances and re-spaces on a
          rezoom (glides via the gridline transition). Density reads the zoom level. */}
      <div className="cg-pistons__grid" aria-hidden="true">
        {zoom.lines.map((l) => (
          <div key={l.m} className="cg-pistons__gridline" style={{ left: `${(l.x * 100).toFixed(2)}%` }} />
        ))}
      </div>

      <div className="cg-pistons__lanes">
        {riderIds.map((id, idx) => {
          const color = LINE_COLORS[idx % LINE_COLORS.length];
          const xPct = (xOf(id) * 100).toFixed(2);
          const isGhost = !!riders[id]?.isGhost;
          const isLeader = ranked[0] === id && distOf(id) > 0;
          const live = riderLive[id] || {};

          // Connector to the NEXT lane (stable order): a segment spanning the two
          // tips with a centered "X m" gap label, sitting in the space between rows.
          const nextId = riderIds[idx + 1];
          let connector = null;
          if (nextId != null) {
            const xa = xOf(id);
            const xb = xOf(nextId);
            const segLeft = Math.min(xa, xb) * 100;
            const segWidth = Math.abs(xa - xb) * 100;
            const gapM = Math.abs(distOf(id) - distOf(nextId));
            connector = (
              <div className="cg-pistons__gap" key={`gap-${id}`} aria-hidden="true">
                <div className="cg-pistons__gapseg" style={{ left: `${segLeft.toFixed(2)}%`, width: `${segWidth.toFixed(2)}%` }}>
                  <span className="cg-pistons__gaplabel">{formatDistance(gapM)}</span>
                </div>
              </div>
            );
          }

          return (
            <React.Fragment key={id}>
              <div className={`cg-pistons__row${isLeader ? ' is-leader' : ''}`} data-testid="piston-row">
                <div className="cg-pistons__track">
                  <div
                    className="cg-pistons__bar"
                    data-testid="piston-bar"
                    style={{ width: `${xPct}%`, '--cg-piston-color': color, opacity: isGhost ? 0.55 : 1 }}
                  />
                  <div
                    className={`cg-pistons__head${isGhost ? ' is-ghost' : ''}`}
                    style={{ left: `${xPct}%`, '--cg-piston-color': color }}
                  >
                    {(() => {
                      const avatar = (
                        <CircularUserAvatar
                          name={riders[id]?.displayName}
                          avatarSrc={live.avatarSrc}
                          heartRate={live.heartRate}
                          zoneId={live.zoneId}
                          zoneColor={live.zoneColor || color}
                          size={38}
                          showGauge={false}
                          showIndicator={false}
                        />
                      );
                      return isGhost ? <span className="cg-ghost">{avatar}</span> : avatar;
                    })()}
                    {/* Distance label rides the tip so the track spans full width and
                        the grid lines line up with the bars. */}
                    <span className="cg-pistons__headdist" data-testid="piston-dist">{formatDistance(distOf(id))}</span>
                  </div>
                </div>
              </div>
              {connector}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

RacePistons.propTypes = {
  riderIds: PropTypes.array.isRequired,
  riders: PropTypes.object.isRequired,
  riderLive: PropTypes.object
};
