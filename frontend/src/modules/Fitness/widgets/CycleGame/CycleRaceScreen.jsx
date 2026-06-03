import React, { useRef } from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import CycleSpeedometer from './CycleSpeedometer.jsx';
import { formatClock } from '@/modules/Fitness/lib/cycleGame/cycleGameLobby.js';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import { DaylightMediaPath } from '@/lib/api.mjs';
import './CycleRaceScreen.scss';

const LINE_COLORS = ['#3ddc84', '#ff9f43', '#a66cff'];
const FALLBACK_AVATAR = '/api/v1/static/img/users/user';

/**
 * Presentational race screen — a velodrome broadcast HUD: framed race clock on
 * top, a gradient-filled distance chart (one climbing lane per rider toward the
 * goal) with gridlines + gliding rider chips, and a row of CycleSpeedometers
 * beneath. Pure — the live container feeds it engine state + per-rider metrics.
 */
export default function CycleRaceScreen({
  winCondition = 'distance', goalM = 3000, timeCapS = 300, elapsedS = 0,
  riders = {}, riderLive = {}, cadenceBands = [], backgroundPlexId = null,
  showSpeedos = true
}) {
  const riderIds = Object.keys(riders);
  const clockSeconds = winCondition === 'time' ? Math.max(0, timeCapS - elapsedS) : elapsedS;

  // chart scaling
  const maxSeriesLen = Math.max(1, ...riderIds.map((id) => (riders[id].distanceSeries || []).length));
  const maxDistance = winCondition === 'distance'
    ? goalM
    : Math.max(1, ...riderIds.map((id) => riders[id].cumulativeDistanceM || 0));
  const W = 600, H = 200;
  const xFor = (i) => (maxSeriesLen <= 1 ? 0 : (i / (maxSeriesLen - 1)) * W);

  // Auto-scale: linear by default, switch to logarithmic when the riders' tips
  // crowd together (so close finishers stay legible). Sticky via a ref so it
  // doesn't flicker tick-to-tick near the threshold.
  const lastDists = riderIds.map((id) => (riders[id].distanceSeries || []).slice(-1)[0] || 0);
  const logRef = useRef(false);
  if (riderIds.length >= 2) {
    const sorted = [...lastDists].sort((a, b) => a - b);
    let minGap = Infinity;
    for (let i = 1; i < sorted.length; i++) minGap = Math.min(minGap, sorted[i] - sorted[i - 1]);
    if (!logRef.current && minGap < maxDistance * 0.05) logRef.current = true;
    else if (logRef.current && minGap > maxDistance * 0.14) logRef.current = false;
  } else {
    logRef.current = false;
  }
  const useLog = logRef.current;
  const yFor = (d) => {
    if (useLog) {
      const D = Math.max(1, maxDistance);
      return H - (Math.log1p(Math.max(0, d || 0)) / Math.log1p(D)) * H;
    }
    return H - Math.min(1, (d || 0) / maxDistance) * H;
  };

  // leader (for emphasis) — furthest along
  const leaderId = riderIds.reduce(
    (best, id) => (best == null || (riders[id].cumulativeDistanceM || 0) > (riders[best].cumulativeDistanceM || 0) ? id : best),
    null
  );

  return (
    <div className="cycle-race-screen" data-testid="cycle-race-screen">
      {/* Ambient background video — only mounts when a Plex id is configured (null = no video). */}
      {backgroundPlexId && (
        <video
          className="cycle-race-screen__bg"
          data-testid="cycle-race-bg"
          src={DaylightMediaPath(`api/v1/play/plex/${String(backgroundPlexId).replace(/^plex:/i, '')}`)}
          autoPlay
          muted
          loop
          playsInline
          aria-hidden="true"
        />
      )}
      <div className="cycle-race-screen__vignette" aria-hidden="true" />

      <div className="cycle-race-screen__clock-frame">
        <span className="cycle-race-screen__clock-label">
          {winCondition === 'time' ? 'Time left' : 'Elapsed'}
        </span>
        <span className="cycle-race-screen__clock" data-testid="race-clock">{formatClock(clockSeconds)}</span>
        <span className="cycle-race-screen__clock-goal">
          {winCondition === 'distance' ? `to ${formatDistance(goalM)}` : `${formatDistance(maxDistance)} led`}
        </span>
      </div>

      <div className="cycle-race-screen__chart-wrap">
        <svg className="cycle-race-screen__chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            {riderIds.map((id, idx) => {
              const color = LINE_COLORS[idx % LINE_COLORS.length];
              return (
                <linearGradient key={`g-${id}`} id={`cg-fill-${idx}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity="0.34" />
                  <stop offset="100%" stopColor={color} stopOpacity="0.02" />
                </linearGradient>
              );
            })}
          </defs>

          {winCondition === 'distance' && (
            <line className="cycle-race-screen__goal" x1="0" y1="0" x2={W} y2="0" vectorEffect="non-scaling-stroke" />
          )}

          {/* area fills (under each lane) */}
          {riderIds.map((id, idx) => {
            const series = riders[id].distanceSeries || [];
            if (series.length === 0) return null;
            const linePts = series.map((d, i) => `${xFor(i).toFixed(1)},${yFor(d).toFixed(1)}`).join(' ');
            const lastX = xFor(series.length - 1).toFixed(1);
            const area = `0,${H} ${linePts} ${lastX},${H}`;
            return (
              <polygon
                key={`area-${id}`}
                points={area}
                fill={`url(#cg-fill-${idx})`}
                opacity={riders[id].isGhost ? 0.4 : 1}
              />
            );
          })}

          {/* lane lines */}
          {riderIds.map((id, idx) => {
            const series = riders[id].distanceSeries || [];
            const pts = series.map((d, i) => `${xFor(i).toFixed(1)},${yFor(d).toFixed(1)}`).join(' ');
            const color = LINE_COLORS[idx % LINE_COLORS.length];
            const isGhost = !!riders[id].isGhost;
            return (
              <polyline
                key={id}
                data-testid="race-line"
                points={pts}
                fill="none"
                stroke={color}
                strokeWidth={isGhost ? 2 : 3}
                strokeDasharray={isGhost ? '5 6' : undefined}
                opacity={isGhost ? 0.8 : 1}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        {/* Terminus markers: each line's tip carries the rider's avatar + running
            score (distance) + live HR. Distance is read here, not off a y-axis. */}
        <div className="cycle-race-screen__tags">
          {riderIds.map((id, idx) => {
            const series = riders[id].distanceSeries || [];
            if (series.length === 0) return null;
            const leftPct = (xFor(series.length - 1) / W) * 100;
            const topPct = (yFor(series[series.length - 1]) / H) * 100;
            const color = LINE_COLORS[idx % LINE_COLORS.length];
            const isGhost = !!riders[id].isGhost;
            const live = riderLive[id] || {};
            const hr = Number.isFinite(live.heartRate) ? Math.round(live.heartRate) : null;
            return (
              <div
                key={`tag-${id}`}
                className={`cycle-race-screen__tag${isGhost ? ' is-ghost' : ''}${id === leaderId ? ' is-leader' : ''}`}
                style={{ left: `${leftPct}%`, top: `${topPct}%` }}
              >
                <span className={`cycle-race-screen__tag-avatar${isGhost ? ' cg-ghost' : ''}`}>
                  <CircularUserAvatar
                    name={riders[id].displayName}
                    avatarSrc={live.avatarSrc}
                    fallbackSrc={FALLBACK_AVATAR}
                    size={40}
                    showGauge={false}
                    showIndicator={false}
                  />
                </span>
                <span className="cycle-race-screen__tag-info">
                  <span className="cycle-race-screen__tag-score" style={{ color }}>
                    {formatDistance(riders[id].cumulativeDistanceM || 0)}
                  </span>
                  {hr != null && (
                    <span className="cycle-race-screen__tag-hr">{hr}<span className="cycle-race-screen__tag-hr-icon">♥</span></span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {showSpeedos && (
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
                isGhost={!!riders[id].isGhost}
                size={260}
              />
            );
          })}
        </div>
      )}
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
  backgroundPlexId: PropTypes.string,
  showSpeedos: PropTypes.bool
};
