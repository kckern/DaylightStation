import React from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';

const FALLBACK_AVATAR = '/api/v1/static/img/users/user';

/**
 * Roster panel (right of the chart): riders sorted by who's ahead, each row
 * showing rank, avatar (with live HR gauge), name, and running distance.
 */
export default function Rankings({ riderIds, riders, riderLive }) {
  const roster = [...riderIds]
    .sort((a, b) => (riders[b].cumulativeDistanceM || 0) - (riders[a].cumulativeDistanceM || 0))
    .map((id) => {
      const origIdx = riderIds.indexOf(id);
      return {
        id,
        displayName: riders[id].displayName || id,
        distanceM: riders[id].cumulativeDistanceM || 0,
        isGhost: !!riders[id].isGhost,
        color: LINE_COLORS[origIdx % LINE_COLORS.length],
        live: riderLive[id] || {}
      };
    });

  return (
    <aside className="cycle-race-screen__roster" data-testid="race-roster">
      {roster.map((r, i) => (
        <div key={`roster-${r.id}`} data-testid="roster-row" className={`cycle-race-screen__roster-row${r.isGhost ? ' is-ghost' : ''}`}>
          <span className="cycle-race-screen__roster-rank">{i + 1}</span>
          <span className={`cycle-race-screen__roster-avatar${r.isGhost ? ' cg-ghost' : ''}`}>
            <CircularUserAvatar
              name={r.displayName}
              avatarSrc={r.live.avatarSrc}
              fallbackSrc={FALLBACK_AVATAR}
              heartRate={Number.isFinite(r.live.heartRate) ? r.live.heartRate : undefined}
              zoneColor={r.live.zoneColor || r.color}
              size={44}
              showGauge={Number.isFinite(r.live.heartRate) && r.live.heartRate > 0}
              showIndicator={false}
            />
          </span>
          <span className="cycle-race-screen__roster-main">
            <span className="cycle-race-screen__roster-name">{r.displayName}</span>
            <span className="cycle-race-screen__roster-metric" style={{ color: r.color }}>{formatDistance(r.distanceM)}</span>
          </span>
        </div>
      ))}
    </aside>
  );
}

Rankings.propTypes = {
  riderIds: PropTypes.array.isRequired,
  riders: PropTypes.object.isRequired,
  riderLive: PropTypes.object.isRequired
};
