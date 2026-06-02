import React from 'react';
import PropTypes from 'prop-types';
import CycleSpeedometer from './CycleSpeedometer.jsx';
import { formatClock } from '@/modules/Fitness/lib/cycleGame/cycleGameLobby.js';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import { DaylightMediaPath } from '@/lib/api.mjs';
import './CycleRaceScreen.scss';

const LINE_COLORS = ['#3ddc84', '#ff9f43', '#a66cff'];

/**
 * Presentational race screen — a velodrome broadcast HUD: framed race clock on
 * top, a gradient-filled distance chart (one climbing lane per rider toward the
 * goal) with gridlines + gliding rider chips, and a row of CycleSpeedometers
 * beneath. Pure — the live container feeds it engine state + per-rider metrics.
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
  const xFor = (i) => (maxSeriesLen <= 1 ? 0 : (i / (maxSeriesLen - 1)) * W);
  const yFor = (d) => H - Math.min(1, (d || 0) / maxDistance) * H;

  // leader (for emphasis) — furthest along
  const leaderId = riderIds.reduce(
    (best, id) => (best == null || (riders[id].cumulativeDistanceM || 0) > (riders[best].cumulativeDistanceM || 0) ? id : best),
    null
  );

  const gridFracs = [0.25, 0.5, 0.75];

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

          {/* gridlines */}
          {gridFracs.map((f) => (
            <line
              key={`grid-${f}`}
              className="cycle-race-screen__grid"
              x1="0" x2={W} y1={yFor(maxDistance * f)} y2={yFor(maxDistance * f)}
              vectorEffect="non-scaling-stroke"
            />
          ))}

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

        {/* HTML overlays (no SVG distortion): distance gridline labels + gliding rider chips */}
        <div className="cycle-race-screen__grid-labels" aria-hidden="true">
          {[...gridFracs, 1].map((f) => (
            <span key={`gl-${f}`} className="cycle-race-screen__grid-label" style={{ top: `${(yFor(maxDistance * f) / H) * 100}%` }}>
              {formatDistance(maxDistance * f)}
            </span>
          ))}
        </div>

        <div className="cycle-race-screen__heads">
          {riderIds.map((id, idx) => {
            const series = riders[id].distanceSeries || [];
            if (series.length === 0) return null;
            const leftPct = (xFor(series.length - 1) / W) * 100;
            const topPct = (yFor(series[series.length - 1]) / H) * 100;
            const color = LINE_COLORS[idx % LINE_COLORS.length];
            const isGhost = !!riders[id].isGhost;
            return (
              <div
                key={`head-${id}`}
                className={`cycle-race-screen__rider-tag${isGhost ? ' is-ghost' : ''}${id === leaderId ? ' is-leader' : ''}`}
                style={{ left: `${leftPct}%`, top: `${topPct}%` }}
              >
                <span className="cycle-race-screen__rider-name" style={{ color }}>
                  {riders[id].displayName || id}
                </span>
                <span className="cycle-race-screen__head" style={{ background: color }} />
              </div>
            );
          })}
        </div>
      </div>

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
              size={260}
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
