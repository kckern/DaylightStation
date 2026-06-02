import React from 'react';
import PropTypes from 'prop-types';
import CycleSpeedometer from './CycleSpeedometer.jsx';
import { formatClock } from '@/modules/Fitness/lib/cycleGame/cycleGameLobby.js';
import './CycleRaceScreen.scss';

const LINE_COLORS = ['#2ecc71', '#e67e22', '#9b59b6'];

/**
 * Presentational race screen: clock on top, a distance chart (one climbing line
 * per rider toward the goal), and a modular row of CycleSpeedometers beneath.
 * Pure — the live container feeds it engine state + per-rider live metrics.
 */
export default function CycleRaceScreen({
  winCondition = 'distance', goalM = 3000, timeCapS = 300, elapsedS = 0,
  riders = {}, riderLive = {}, cadenceBands = [], backgroundPlexId = null
}) {
  const riderIds = Object.keys(riders);
  const clockSeconds = winCondition === 'time' ? Math.max(0, timeCapS - elapsedS) : elapsedS;

  // chart scaling
  const maxSeriesLen = Math.max(1, ...riderIds.map((id) => (riders[id].distanceSeries || []).length));
  const maxDistance = winCondition === 'distance'
    ? goalM
    : Math.max(1, ...riderIds.map((id) => riders[id].cumulativeDistanceM || 0));
  const W = 600, H = 200;
  const xFor = (i) => maxSeriesLen <= 1 ? 0 : (i / (maxSeriesLen - 1)) * W;
  const yFor = (d) => H - Math.min(1, (d || 0) / maxDistance) * H;

  return (
    <div className="cycle-race-screen" data-testid="cycle-race-screen">
      {backgroundPlexId && <div className="cycle-race-screen__bg" data-plex={backgroundPlexId} aria-hidden="true" />}

      <div className="cycle-race-screen__clock" data-testid="race-clock">{formatClock(clockSeconds)}</div>

      <svg className="cycle-race-screen__chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {winCondition === 'distance' && (
          <line className="cycle-race-screen__goal" x1="0" y1="0" x2={W} y2="0" />
        )}
        {riderIds.map((id, idx) => {
          const series = riders[id].distanceSeries || [];
          const pts = series.map((d, i) => `${xFor(i).toFixed(1)},${yFor(d).toFixed(1)}`).join(' ');
          return (
            <polyline
              key={id}
              data-testid="race-line"
              points={pts}
              fill="none"
              stroke={LINE_COLORS[idx % LINE_COLORS.length]}
              strokeWidth="3"
            />
          );
        })}
      </svg>

      <div className="cycle-race-screen__speedos">
        {riderIds.map((id, idx) => {
          const live = riderLive[id] || {};
          return (
            <CycleSpeedometer
              key={id}
              rpm={live.rpm}
              cadenceBands={cadenceBands}
              distanceMeters={riders[id].cumulativeDistanceM}
              multiplier={live.multiplier}
              avatar={{
                name: riders[id].displayName,
                src: live.avatarSrc,
                heartRate: live.heartRate,
                zoneId: live.zoneId,
                zoneColor: live.zoneColor || LINE_COLORS[idx % LINE_COLORS.length],
                progress: live.zoneProgress
              }}
              size={200}
            />
          );
        })}
      </div>
    </div>
  );
}

CycleRaceScreen.propTypes = {
  winCondition: PropTypes.string,
  goalM: PropTypes.number,
  timeCapS: PropTypes.number,
  elapsedS: PropTypes.number,
  riders: PropTypes.object,
  riderLive: PropTypes.object,
  cadenceBands: PropTypes.array,
  backgroundPlexId: PropTypes.string
};
