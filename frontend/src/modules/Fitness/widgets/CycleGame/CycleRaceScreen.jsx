import React from 'react';
import PropTypes from 'prop-types';
import { ovalProgressFor } from '@/modules/Fitness/lib/cycleGame/ovalTrackModel.js';
import { lapCount } from '@/modules/Fitness/lib/cycleGame/lapModel.js';
import { DaylightMediaPath } from '@/lib/api.mjs';
import DistanceChart from './panels/DistanceChart.jsx';
import PovGrid from './panels/PovGrid.jsx';
import OvalTrack from './panels/OvalTrack.jsx';
import SpeedoRow from './panels/SpeedoRow.jsx';
import RaceLayoutManager from './RaceLayoutManager.jsx';
import './CycleRaceScreen.scss';

/**
 * Presentational race screen — a velodrome broadcast HUD. RaceLayoutManager picks a
 * fixed layout by field size: ≤3 riders → sidebar mode (distance chart over the
 * speedometers, with a POV grid + lap oval in a right sidebar); ≥4 riders → wide
 * mode (chart 2× | POV across the top, speedometers full-width, no oval). The
 * race clock lives inside the chart's header. Pure — the live container feeds it
 * engine state + per-rider metrics.
 */
export default function CycleRaceScreen({
  winCondition = 'distance', goalM = 3000, timeCapS = 300, elapsedS = 0,
  riders = {}, riderLive = {}, cadenceBands = [], backgroundPlexId = null,
  showSpeedos = true, lapLengthM = 0, events = [], ovalCircuitM = 1000
}) {
  const riderIds = Object.keys(riders);

  const clockSeconds = winCondition === 'time' ? Math.max(0, timeCapS - elapsedS) : elapsedS;

  // False-start banner: who is currently serving a hot-start penalty (meter
  // locked because they were pedalling at the green light).
  const penalizedNames = riderIds
    .filter((id) => (riderLive[id] || {}).penalized)
    .map((id) => riders[id].displayName || id);

  const maxDistance = winCondition === 'distance'
    ? goalM
    : Math.max(1, ...riderIds.map((id) => riders[id].cumulativeDistanceM || 0));

  const fieldSize = riderIds.length;
  const leaderLap = lapLengthM > 0
    ? lapCount(Math.max(0, ...riderIds.map((id) => riders[id]?.cumulativeDistanceM || 0)), lapLengthM) + 1
    : 0;
  const ovalProgress = Object.fromEntries(riderIds.map((id) => [
    id, ovalProgressFor({ winCondition, distanceM: riders[id]?.cumulativeDistanceM || 0, goalM, ovalCircuitM, lapLengthM })
  ]));

  // Each factory receives the PanelSlot-injected slot props ({ zoneBox }) and
  // MUST forward zoneBox to panels that size from it (DistanceChart's fit-guard,
  // SpeedoRow's gauge sizing) — otherwise the measured band is lost and SpeedoRow
  // falls back to its 96px gauge floor.
  const panels = {
    distanceChart: (slot) => (
      <DistanceChart riderIds={riderIds} riders={riders} riderLive={riderLive}
        winCondition={winCondition} goalM={goalM} events={events} elapsedS={elapsedS}
        clockSeconds={clockSeconds} maxDistanceM={maxDistance} zoneBox={slot?.zoneBox} />
    ),
    povGrid: () => (
      <PovGrid riderIds={riderIds} riders={riders} riderLive={riderLive} />
    ),
    ovalTrack: () => (
      <OvalTrack riderIds={riderIds} riders={riders} riderLive={riderLive}
        progress={ovalProgress} lapLabel={leaderLap > 0 ? `Lap ${leaderLap}` : null}
        lapLengthM={lapLengthM} elapsedS={elapsedS} />
    ),
    ...(showSpeedos ? {
      speedoRow: (slot) => (
        <SpeedoRow riderIds={riderIds} riders={riders} riderLive={riderLive}
          cadenceBands={cadenceBands} zoneBox={slot?.zoneBox}
          maxGauge={fieldSize <= 3 ? 360 : 280} minGauge={fieldSize <= 3 ? 220 : 96} />
      )
    } : {})
  };

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

      {penalizedNames.length > 0 && (
        <div className="cycle-race-screen__penalty-banner" data-testid="cycle-race-penalty-banner" role="alert">
          <span className="cycle-race-screen__penalty-icon" aria-hidden="true">⛔</span>
          <span className="cycle-race-screen__penalty-text">
            False start — {penalizedNames.join(', ')} jumped the gun (meter locked)
          </span>
        </div>
      )}

      <RaceLayoutManager panels={panels} fieldSize={fieldSize} />
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
  showSpeedos: PropTypes.bool,
  lapLengthM: PropTypes.number,
  ovalCircuitM: PropTypes.number,
  events: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.number,
    type: PropTypes.oneOf(['dnf', 'penalty']),
    riderId: PropTypes.string,
    seriesIndex: PropTypes.number,
    distanceM: PropTypes.number
  }))
};
