import React from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import './RacePistons.scss';

/**
 * "Piston" race chart — a stacked one-dimensional standings view. One horizontal
 * bar per rider in a FIXED vertical lane order, each bar's length set by the
 * rider's distance relative to the current leader, so the leader's bar reaches the
 * right edge and the field trails behind it. A small avatar rides each bar's tip.
 *
 * The bars + tips glide (CSS transition) as gaps open and close, so the column
 * reads like pistons firing — whoever's ahead pulls right, whoever falls back
 * shortens. Pure presentational; relative scaling (to the leader) keeps the leader
 * pinned right regardless of absolute distance.
 */
export default function RacePistons({ riderIds, riders, riderLive = {} }) {
  const distOf = (id) => Math.max(0, riders[id]?.cumulativeDistanceM || 0);
  // Scale to the leader so the furthest rider always pins the right edge and the
  // others read as their fraction of the leader's distance (the gap).
  const leader = Math.max(1, ...riderIds.map(distOf));
  const frac = (id) => Math.max(0, Math.min(1, distOf(id) / leader));
  // Rank for the leader flag (furthest = 1st) without reordering the lanes.
  const ranked = [...riderIds].sort((a, b) => distOf(b) - distOf(a));

  return (
    <div className="cg-pistons" data-testid="race-pistons">
      {riderIds.map((id, idx) => {
        const color = LINE_COLORS[idx % LINE_COLORS.length];
        const f = frac(id);
        const isGhost = !!riders[id]?.isGhost;
        const isLeader = ranked[0] === id && distOf(id) > 0;
        const live = riderLive[id] || {};
        return (
          <div className={`cg-pistons__row${isLeader ? ' is-leader' : ''}`} key={id} data-testid="piston-row">
            <div className="cg-pistons__track">
              <div
                className="cg-pistons__bar"
                data-testid="piston-bar"
                style={{ width: `${(f * 100).toFixed(2)}%`, '--cg-piston-color': color, opacity: isGhost ? 0.55 : 1 }}
              />
              <div
                className={`cg-pistons__head${isGhost ? ' is-ghost' : ''}`}
                style={{ left: `${(f * 100).toFixed(2)}%`, '--cg-piston-color': color }}
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
                  // Ghost riders get the canonical grayscale+tint treatment (the same
                  // .cg-ghost used by the speedometer/rankings/results), not a bare opacity.
                  return isGhost ? <span className="cg-ghost">{avatar}</span> : avatar;
                })()}
              </div>
            </div>
            <div className="cg-pistons__dist" data-testid="piston-dist">{formatDistance(distOf(id))}</div>
          </div>
        );
      })}
    </div>
  );
}

RacePistons.propTypes = {
  riderIds: PropTypes.array.isRequired,
  riders: PropTypes.object.isRequired,
  riderLive: PropTypes.object
};
