import React, { useRef } from 'react';
import PropTypes from 'prop-types';
import { formatClock } from '@/modules/Fitness/lib/cycleGame/cycleGameLobby.js';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import { deriveRaceSnapshot } from '@/modules/Fitness/lib/cycleGame/deriveRaceSnapshot.js';
import { raceDirector } from '@/modules/Fitness/lib/cycleGame/raceDirector.js';
import { circuitTargetFor, circuitProgress } from '@/modules/Fitness/lib/cycleGame/ovalTrackModel.js';
import { DaylightMediaPath } from '@/lib/api.mjs';
import DistanceChart from './panels/DistanceChart.jsx';
import Rankings from './panels/Rankings.jsx';
import SpeedoRow from './panels/SpeedoRow.jsx';
import LapTable from './panels/LapTable.jsx';
import OvalTrack from './panels/OvalTrack.jsx';
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
  const panels = {
    distanceChart: () => (
      <DistanceChart riderIds={riderIds} riders={riders} riderLive={riderLive}
        winCondition={winCondition} goalM={goalM} events={events} elapsedS={elapsedS} />
    ),
    rankings: () => (
      <Rankings riderIds={riderIds} riders={riders} riderLive={riderLive} winCondition={winCondition} />
    ),
    lapTable: () => (
      <LapTable riderIds={riderIds} riders={riders}
        lapSplits={Object.fromEntries(riderIds.map((id) => [id, riders[id].lapSplits || []]))} />
    ),
    ovalTrack: () => (
      <OvalTrack riderIds={riderIds} riders={riders} riderLive={riderLive}
        progress={Object.fromEntries(riderIds.map((id) => [
          id,
          circuitProgress(
            riders[id]?.cumulativeDistanceM || 0,
            circuitTargetFor(winCondition, goalM, ovalCircuitM),
            { clamp: winCondition === 'distance' }
          )
        ]))} />
    ),
    cameraZoom: () => (
      <CameraZoom riderIds={riderIds} riders={riders} riderLive={riderLive} />
    ),
    ...(showSpeedos ? {
      speedoRow: () => (
        <SpeedoRow riderIds={riderIds} riders={riders} riderLive={riderLive} cadenceBands={cadenceBands} />
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

      <RaceLayoutManager decision={decision} panels={panels} />
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
