import React from 'react';
import PropTypes from 'prop-types';
import { lapCount } from "../../lib/cycleGame/lapModel.js";
import { effectiveLapLength } from "../../lib/cycleGame/effectiveLapLength.js";
import { laneColorVars } from "../../lib/cycleGame/lineColors.js";
import {
  SPEEDO_MIN_GAUGE_SIDEBAR, SPEEDO_MAX_GAUGE_SIDEBAR,
  SPEEDO_MIN_GAUGE_WIDE, SPEEDO_MAX_GAUGE_WIDE, raceLayoutMode
} from "../../lib/cycleGame/layoutSizing.js";
import { paceDelta } from "../../lib/cycleGame/paceDelta.js";
import { DaylightMediaPath } from '@/lib/api.mjs';
import DistanceChart from "./panels/DistanceChart.jsx";
import PovGrid from "./panels/PovGrid.jsx";
import StandingsTower from "./panels/StandingsTower.jsx";
import SpeedoRow from "./panels/SpeedoRow.jsx";
import PaceDeltaPanel from "./panels/PaceDeltaPanel.jsx";
import RaceLayoutManager from "./RaceLayoutManager.jsx";
import "./CycleRaceScreen.scss";

// A recorded rider's display name carries a ghost glyph ("Rider B 👻"); the
// pace panel words the rival in a sentence, so it is dropped there.
const plainName = (name) => String(name || '').replace(/\s*👻\s*$/u, '');

/**
 * Presentational race screen — a velodrome broadcast HUD. The layout mode comes
 * from `raceLayoutMode` (live, non-ghost riders and the field size):
 *  - solo (one live rider, at most one rival): chart on top, the rider's gauge
 *    beside the pace-delta panel (rider vs the rival's whole recording), POV as
 *    a right column. No tower, no "Leader", no ranks: there is nobody to rank.
 *  - sidebar (≤3 on the road otherwise): distance chart over the speedometers,
 *    with a POV grid + standings tower in a right sidebar.
 *  - wide (≥4): chart 2× | standings tower across the top, speedometers
 *    full-width, POV grid docked as a right-edge column.
 * The race clock lives inside the chart's header; the standings tower (audit UX
 * §4.1-4.2) is the rank/gap readout in sidebar and wide modes and absorbs the
 * old oval's lap strip into its header.
 *
 * `soloLayout={false}` keeps a one-rider field on the sidebar layout (the recap
 * does this: a 12 s replay reads better as standings than as a pace gap).
 * `OvalTrack` stays in the codebase but is no longer part of this live panel map.
 * Pure — the live container feeds it engine state + per-rider metrics.
 */
export default function CycleRaceScreen({
  winCondition = 'distance', goalM = 3000, timeCapS = 300, elapsedS = 0,
  riders = {}, riderLive = {}, cadenceBands = [], backgroundPlexId = null,
  showSpeedos = true, lapLengthM = 0, rivalKind = null, soloLayout = true,
  finalSeconds = false, finale = false
}) {
  const riderIds = Object.keys(riders);
  const liveIds = riderIds.filter((id) => !riders[id].isGhost);
  const ghostIds = riderIds.filter((id) => riders[id].isGhost);
  const pickedMode = raceLayoutMode({ liveCount: liveIds.length, fieldSize: riderIds.length });
  const mode = pickedMode === 'solo' && !soloLayout ? 'sidebar' : pickedMode;
  const solo = mode === 'solo';

  // Solo: the live rider against the single ghost, over the rival's WHOLE
  // recording (not the part replayed so far) at the recording's own interval.
  // A finished rider's gap freezes at their finish time.
  const soloId = solo ? liveIds[0] : null;
  const soloLive = soloId ? riderLive[soloId] : null;
  const rivalId = solo && ghostIds.length === 1 ? ghostIds[0] : null;
  const rival = rivalId ? riders[rivalId] : null;
  let delta = null;
  if (soloId && rival && Array.isArray(rival.ghostRecordedSeries) && rival.ghostRecordedSeries.length) {
    const me = riders[soloId];
    delta = paceDelta({
      riderDistanceM: me.cumulativeDistanceM || 0,
      elapsedS: Number.isFinite(me.finishTimeS) ? me.finishTimeS : elapsedS,
      rivalSeries: rival.ghostRecordedSeries,
      intervalS: rival.ghostIntervalS
    });
  }
  const rivalName = rival ? plainName(rival.displayName) : '';

  const clockSeconds = winCondition === 'time' ? Math.max(0, timeCapS - elapsedS) : elapsedS;

  const maxDistance = winCondition === 'distance'
    ? goalM
    : Math.max(1, ...riderIds.map((id) => riders[id].cumulativeDistanceM || 0));

  // Effective lap drives the POV lap-gate arches (always-on: configured lap, 400 m
  // default, or the race distance if shorter). Finish line only for distance races.
  const povLapM = effectiveLapLength({ lapLengthM, winCondition, goalM });
  const povFinishM = winCondition === 'distance' ? goalM : null;
  const leaderLap = lapLengthM > 0
    ? lapCount(Math.max(0, ...riderIds.map((id) => riders[id]?.cumulativeDistanceM || 0)), lapLengthM) + 1
    : 0;

  // Each factory receives the PanelSlot-injected slot props ({ zoneBox }) and
  // MUST forward zoneBox to panels that size from it (DistanceChart's fit-guard,
  // SpeedoRow's gauge sizing) — otherwise the measured band is lost and SpeedoRow
  // falls back to its 96px gauge floor.
  const wideGauges = mode === 'wide';
  const panels = {
    distanceChart: (slot) => (
      <DistanceChart riderIds={riderIds} riders={riders} riderLive={riderLive}
        winCondition={winCondition} goalM={goalM} elapsedS={elapsedS}
        clockSeconds={clockSeconds} maxDistanceM={maxDistance} zoneBox={slot?.zoneBox}
        mode={mode} timeCapS={timeCapS} finalSeconds={finalSeconds} />
    ),
    povGrid: () => (
      <PovGrid riderIds={riderIds} riders={riders} riderLive={riderLive}
        lapLengthM={povLapM} finishM={povFinishM} winCondition={winCondition} ranked={!solo} />
    ),
    ...(solo ? {
      paceDelta: (slot) => (
        <PaceDeltaPanel delta={delta} rivalName={rivalName} rivalKind={rivalKind} zoneBox={slot?.zoneBox}
          paused={!!(soloLive && (soloLive.parked || soloLive.noSensor || soloLive.sensorLost))} />
      )
    } : {
      standingsTower: () => (
        <StandingsTower riderIds={riderIds} riders={riders} riderLive={riderLive}
          winCondition={winCondition} lapLabel={leaderLap > 0 ? `Lap ${leaderLap}` : null}
          lapLengthM={lapLengthM} elapsedS={elapsedS} />
      )
    }),
    ...(showSpeedos ? {
      // Solo: the live rider's gauge only (the rival is on the chart, the
      // road and the pace panel), with no placement or leader styling.
      speedoRow: (slot) => (
        <SpeedoRow riderIds={solo ? liveIds : riderIds} riders={riders} riderLive={riderLive}
          cadenceBands={cadenceBands} zoneBox={slot?.zoneBox} ranked={!solo}
          maxGauge={wideGauges ? SPEEDO_MAX_GAUGE_WIDE : SPEEDO_MAX_GAUGE_SIDEBAR}
          minGauge={wideGauges ? SPEEDO_MIN_GAUGE_WIDE : SPEEDO_MIN_GAUGE_SIDEBAR} />
      )
    } : {})
  };

  // Rider-lane CSS custom props (--cg-lane-0…N), injected once at the root so
  // SCSS can reference `var(--cg-lane-N)` for any lane-tinted chrome instead
  // of re-declaring hex literals (audit UX §6.2). Every consumer today still
  // reads LINE_COLORS directly in JS; this is the SSOT for a future SCSS
  // consumer to key off without duplicating the palette.
  const laneVars = laneColorVars(riderIds);

  return (
    <div className={`cycle-race-screen${finale ? ' is-finale' : ''}`} data-testid="cycle-race-screen" style={laneVars}>
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

      <RaceLayoutManager panels={panels} mode={mode} />
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
  /** Who the solo rider is chasing: 'self' | 'household' | 'par' | 'ghost' | null. */
  rivalKind: PropTypes.string,
  soloLayout: PropTypes.bool,
  /** The last ten seconds of a time race: the chart clock grows and pulses. */
  finalSeconds: PropTypes.bool,
  /** From the last minute / last stretch to the end: the vignette tightens. */
  finale: PropTypes.bool
};
