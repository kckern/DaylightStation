import React, { useRef } from 'react';
import PropTypes from 'prop-types';
import { formatClock } from '@/modules/Fitness/lib/cycleGame/cycleGameLobby.js';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import { deriveRaceSnapshot } from '@/modules/Fitness/lib/cycleGame/deriveRaceSnapshot.js';
import { raceDirector } from '@/modules/Fitness/lib/cycleGame/raceDirector.js';
import { ovalProgressFor } from '@/modules/Fitness/lib/cycleGame/ovalTrackModel.js';
import { DaylightMediaPath } from '@/lib/api.mjs';
import DistanceChart from './panels/DistanceChart.jsx';
import Rankings from './panels/Rankings.jsx';
import SpeedoRow from './panels/SpeedoRow.jsx';
import LapPanel from './panels/LapPanel.jsx';
import RacePistons from './panels/RacePistons.jsx';
import CameraZoom from './panels/CameraZoom.jsx';
import RaceLayoutManager from './RaceLayoutManager.jsx';
import './CycleRaceScreen.scss';

/**
 * Presentational race screen — a velodrome broadcast HUD: framed race clock on
 * top, then a director-driven layout (distance chart, rankings, lap table, oval
 * track, transient camera) over a row of CycleSpeedometers. Pure — the live
 * container feeds it engine state + per-rider metrics.
 */
export default function CycleRaceScreen({
  winCondition = 'distance', goalM = 3000, timeCapS = 300, elapsedS = 0,
  riders = {}, riderLive = {}, cadenceBands = [], backgroundPlexId = null,
  showSpeedos = true, lapLengthM = 0, events = [], ovalCircuitM = 1000
}) {
  const riderIds = Object.keys(riders);
  // Solo = exactly one participant (a ghost/pacer would be a second entry). Drives
  // the 50/50 split layout + a larger hero-gauge cap; 2+ keeps the velodrome grid.
  const solo = riderIds.length === 1;

  // Pure race director: derive a snapshot from current engine state, then ask
  // the director which panel owns each layout zone. Sticky refs carry phase /
  // dwell / hysteresis state across renders (mirrors the existing logRef pattern).
  const prevSnapRef = useRef(null);
  const prevDecisionRef = useRef(null);
  const snapshot = deriveRaceSnapshot(
    { elapsedS, winCondition, goalM, timeCapS, finished: false, riders },
    { lapLengthM },
    prevSnapRef.current
  );
  prevSnapRef.current = snapshot;
  const decision = raceDirector(snapshot, prevDecisionRef.current, elapsedS);
  prevDecisionRef.current = decision;

  const clockSeconds = winCondition === 'time' ? Math.max(0, timeCapS - elapsedS) : elapsedS;

  // False-start banner: who is currently serving a hot-start penalty (meter
  // locked because they were pedalling at the green light).
  const penalizedNames = riderIds
    .filter((id) => (riderLive[id] || {}).penalized)
    .map((id) => riders[id].displayName || id);

  // Clock-frame label for time races reads the leading distance. DistanceChart
  // computes its own internally; this is a decoupled duplicate for the label.
  const maxDistance = winCondition === 'distance'
    ? goalM
    : Math.max(1, ...riderIds.map((id) => riders[id].cumulativeDistanceM || 0));

  // Bind extracted panels to current props. speedoRow is included ONLY when
  // showSpeedos is true, so the director assigning it to a hidden row renders
  // nothing (preserves the showSpeedos={false} behavior). An id absent from this
  // map renders as an empty zone gracefully. Officiating-event markers (DNF /
  // penalty) ride the chart, so `events` is threaded into DistanceChart — it owns
  // the xFor/yFor projection those markers need.
  // Each factory receives the PanelSlot-injected slot props ({ zoneBox }) and
  // MUST forward zoneBox to panels that size from it (DistanceChart's fit-guard,
  // SpeedoRow's gauge sizing) — otherwise the measured band is lost and SpeedoRow
  // falls back to its 96px gauge floor.
  const panels = {
    distanceChart: (slot) => (
      <DistanceChart riderIds={riderIds} riders={riders} riderLive={riderLive}
        winCondition={winCondition} goalM={goalM} events={events} elapsedS={elapsedS}
        zoneBox={slot?.zoneBox} />
    ),
    rankings: () => (
      <Rankings riderIds={riderIds} riders={riders} riderLive={riderLive} winCondition={winCondition} />
    ),
    lapPanel: () => (
      <LapPanel riderIds={riderIds} riders={riders} riderLive={riderLive}
        lapSplits={Object.fromEntries(riderIds.map((id) => [id, riders[id].lapSplits || []]))}
        progress={Object.fromEntries(riderIds.map((id) => [
          id,
          ovalProgressFor({
            winCondition,
            distanceM: riders[id]?.cumulativeDistanceM || 0,
            goalM,
            ovalCircuitM,
            lapLengthM
          })
        ]))} />
    ),
    racePistons: () => (
      <RacePistons riderIds={riderIds} riders={riders} riderLive={riderLive} />
    ),
    cameraZoom: () => (
      <CameraZoom riderIds={riderIds} riders={riders} riderLive={riderLive} />
    ),
    ...(showSpeedos ? {
      speedoRow: (slot) => (
        <SpeedoRow riderIds={riderIds} riders={riders} riderLive={riderLive}
          cadenceBands={cadenceBands} zoneBox={slot?.zoneBox}
          maxGauge={solo ? 520 : riderIds.length <= 3 ? 360 : 280}
          minGauge={solo ? 320 : riderIds.length <= 3 ? 220 : 96} />
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

      <div className="cycle-race-screen__clock-frame">
        <span className="cycle-race-screen__clock-label">
          {winCondition === 'time' ? 'Time left' : 'Elapsed'}
        </span>
        <span className="cycle-race-screen__clock" data-testid="race-clock">{formatClock(clockSeconds)}</span>
        <span className="cycle-race-screen__clock-goal">
          {winCondition === 'distance' ? `to ${formatDistance(goalM)}` : `${formatDistance(maxDistance)} led`}
        </span>
      </div>

      {penalizedNames.length > 0 && (
        <div className="cycle-race-screen__penalty-banner" data-testid="cycle-race-penalty-banner" role="alert">
          <span className="cycle-race-screen__penalty-icon" aria-hidden="true">⛔</span>
          <span className="cycle-race-screen__penalty-text">
            False start — {penalizedNames.join(', ')} jumped the gun (meter locked)
          </span>
        </div>
      )}

      <RaceLayoutManager decision={decision} panels={panels} solo={solo} fieldSize={riderIds.length} />
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
