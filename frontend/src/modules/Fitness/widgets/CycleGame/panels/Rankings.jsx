import React from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';

const FALLBACK_AVATAR = '/api/v1/static/img/users/user';
const ROSTER_MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };
const fmtRosterTime = (s) => {
  if (!Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
};

/**
 * Roster panel (right of the chart). In a distance race, riders who have crossed
 * the line float to the top in finish order and show a medal + finish time;
 * everyone else follows by distance. Each row: rank/medal, avatar (live HR
 * gauge), name, and the running distance (or finish time for finishers).
 */
export default function Rankings({ riderIds, riders, riderLive, winCondition = 'distance' }) {
  const isDistanceRace = winCondition === 'distance';
  const roster = [...riderIds]
    .sort((a, b) => {
      const fa = riders[a].finishTimeS, fb = riders[b].finishTimeS;
      const aDone = isDistanceRace && fa != null, bDone = isDistanceRace && fb != null;
      if (aDone && bDone) return fa - fb;
      if (aDone) return -1;
      if (bDone) return 1;
      return (riders[b].cumulativeDistanceM || 0) - (riders[a].cumulativeDistanceM || 0);
    })
    .map((id, i) => {
      const origIdx = riderIds.indexOf(id);
      const finishTimeS = isDistanceRace ? riders[id].finishTimeS : null;
      return {
        id,
        displayName: riders[id].displayName || id,
        distanceM: riders[id].cumulativeDistanceM || 0,
        finished: finishTimeS != null,
        finishTimeS,
        placement: finishTimeS != null ? i + 1 : null,
        isGhost: !!riders[id].isGhost,
        color: LINE_COLORS[origIdx % LINE_COLORS.length],
        live: riderLive[id] || {}
      };
    });

  return (
    <aside className="cycle-race-screen__roster" data-testid="race-roster">
      {roster.map((r, i) => (
        <div key={`roster-${r.id}`} data-testid="roster-row" className={`cycle-race-screen__roster-row${r.isGhost ? ' is-ghost' : ''}${r.finished ? ' is-finished' : ''}`}>
          <span className="cycle-race-screen__roster-rank">
            {r.finished ? (ROSTER_MEDALS[r.placement] || r.placement) : i + 1}
          </span>
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
            <span className="cycle-race-screen__roster-metric" style={{ color: r.color }}>
              {r.finished ? `🏁 ${fmtRosterTime(r.finishTimeS)}` : formatDistance(r.distanceM)}
            </span>
          </span>
        </div>
      ))}
    </aside>
  );
}

Rankings.propTypes = {
  riderIds: PropTypes.array.isRequired,
  riders: PropTypes.object.isRequired,
  riderLive: PropTypes.object.isRequired,
  winCondition: PropTypes.string
};
