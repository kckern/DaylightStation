import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { uiLog } from './home/uiLog.js';
import { RaceFlagIcon, VolumeIcon } from './home/icons.jsx';
import RaceTypePicker from './home/RaceTypePicker.jsx';
import BikeSlot from './home/BikeSlot.jsx';
import GhostSlot from './home/GhostSlot.jsx';
import RiderPicker from './home/RiderPicker.jsx';
import GhostPicker from './home/GhostPicker.jsx';
import VolumeModal from './home/VolumeModal.jsx';
import HighScores from './home/HighScores.jsx';
import HistoryTable from './home/HistoryTable.jsx';
import FeaturedCourseCard from './home/FeaturedCourseCard.jsx';
import './CycleGameHome.scss';

// How long the "recovered your interrupted race" banner stays up before it
// self-dismisses (audit C1 follow-up — recovery used to be log-only).
const RECOVERED_NOTICE_DURATION_MS = 8000;

/**
 * Cycle-game home (the `idle` lifecycle state). A designed lobby: race-type
 * dichotomy (Distance vs Time) with a second-order value step, a starting grid
 * of bikes with on-screen rider assignment, and a separate Records rail. Fully
 * prop-driven; the container supplies data + handlers. The main panel is
 * center-aligned throughout.
 */
export default function CycleGameHome({
  raceType = null,
  onSelectRaceType,
  raceValue,
  onSetRaceValue,
  bikes = [],
  people = [],
  onAssign,
  onUnassign,
  records = [],
  highScores = [],
  onSelectRecord,
  ghost = null,
  ghostRoster = [],
  ghostCandidates = [],
  onSelectGhost,
  onClearGhost,
  masterVolume = 1,
  masterMuted = false,
  onSetMasterVolume,
  onStart,
  canStart = false,
  featured = null,
  onRideFeatured = null,
  resolveName = (id) => id,
  recoveredNotice = null
}) {
  const [pickerBike, setPickerBike] = useState(null);
  const [showGhostPicker, setShowGhostPicker] = useState(false);
  const [showVolume, setShowVolume] = useState(false);
  // Self-dismissing: a fresh notice text re-arms the timer; the container also
  // clears its own state on timeout/race-start, but the DOM here hides itself
  // independently so a stale prop can never linger visually past 8s.
  const [noticeVisible, setNoticeVisible] = useState(false);
  useEffect(() => {
    if (!recoveredNotice) { setNoticeVisible(false); return undefined; }
    setNoticeVisible(true);
    const id = setTimeout(() => setNoticeVisible(false), RECOVERED_NOTICE_DURATION_MS);
    return () => clearTimeout(id);
  }, [recoveredNotice]);

  const peopleById = useMemo(() => {
    const map = new Map();
    people.forEach((p) => map.set(p.id, p));
    return map;
  }, [people]);

  const handleAssign = (bikeId, userId) => {
    onAssign?.(bikeId, userId);
    setPickerBike(null);
  };

  const handleClear = (bikeId) => {
    onUnassign?.(bikeId);
    setPickerBike(null);
  };

  return (
    <div className="cycle-game-home" data-testid="cycle-game-home">
      {noticeVisible && recoveredNotice && (
        <div className="cgh-recovered-banner" data-testid="cycle-recovered-banner" role="status" aria-live="polite">
          {recoveredNotice}
        </div>
      )}
      <button
        type="button"
        className={`cgh-volume-fab cgh-volume-fab--corner${masterMuted ? ' is-muted' : ''}`}
        data-testid="cycle-game-volume-open"
        aria-label={masterMuted ? 'Volume — muted' : `Volume — ${Math.round((masterVolume ?? 0) * 100)}%`}
        onClick={() => { uiLog().debug('cycle_game.ui.volume_open', {}); setShowVolume(true); }}
      >
        <VolumeIcon muted={masterMuted} />
      </button>

      <div className="cycle-game-home__main">
        <header className="cycle-game-home__header">
          <h2 className="cycle-game-home__title">Cycle Race</h2>
          <p className="cycle-game-home__subtitle">Pick a race, line up the riders, and go.</p>
        </header>

        <RaceTypePicker
          raceType={raceType}
          onSelectRaceType={onSelectRaceType}
          raceValue={raceValue}
          onSetRaceValue={onSetRaceValue}
          ghost={ghost}
          onPickGhost={() => { uiLog().info('cycle_game.ui.ghost_picker_open', {}); setShowGhostPicker(true); }}
          onClearGhost={onClearGhost}
        />

        <section className="cgh-grid-section">
          <div className="cgh-section-label">Starting grid</div>
          {bikes.length === 0 && ghostRoster.length === 0 ? (
            <div className="cgh-empty">No bikes detected (equipment with a cadence sensor).</div>
          ) : (
            <div className="cgh-grid">
              {bikes.map((bike, i) => (
                <BikeSlot
                  key={bike.id}
                  bike={bike}
                  lane={i + 1}
                  person={bike.rider ? peopleById.get(bike.rider) || { id: bike.rider, name: bike.rider } : null}
                  onPick={(b) => { uiLog().info('cycle_game.ui.rider_picker_open', { equipmentId: b.id, currentRider: b.rider || null }); setPickerBike(b); }}
                />
              ))}
              {/* Phantom lanes for a selected ghost race (audit C6 / user
                  feedback 2026-07-02) — a ghost is invisible no longer; it
                  lines up in the SAME grid as the real riders. */}
              {ghostRoster.map((r, i) => (
                <GhostSlot key={r.userId} rider={r} lane={bikes.length + i + 1} />
              ))}
            </div>
          )}
        </section>

        <div className="cycle-game-home__actions">
          <button
            type="button"
            className="cycle-game-home__start"
            data-testid="cycle-game-start"
            disabled={!canStart}
            onClick={() => onStart?.()}
          >
            <RaceFlagIcon />
            Start race
          </button>
        </div>
      </div>

      <aside className="cycle-game-home__records" data-testid="cycle-game-records">
        {/* Weekly ladder lives in the records rail — NEVER in the main column,
            where its height displaced the picker/grid/start on the fixed-height
            (unscrollable) garage touchscreen and made the lobby unusable. */}
        <FeaturedCourseCard ladder={featured} onRide={onRideFeatured} resolveName={resolveName} />

        <HighScores highScores={highScores} onSelectRecord={onSelectRecord} />

        <div className="cgh-section-label">History</div>
        <HistoryTable records={records} onSelectRecord={onSelectRecord} />
      </aside>

      {pickerBike && (
        <RiderPicker
          bike={pickerBike}
          people={people}
          currentRiderId={pickerBike.rider || null}
          onAssign={handleAssign}
          onClear={handleClear}
          onClose={() => { uiLog().debug('cycle_game.ui.rider_picker_close', { equipmentId: pickerBike?.id }); setPickerBike(null); }}
        />
      )}

      {showGhostPicker && (
        <GhostPicker
          candidates={ghostCandidates}
          currentGhost={ghost}
          onSelect={(g) => { onSelectGhost?.(g); setShowGhostPicker(false); }}
          onClear={() => { onClearGhost?.(); }}
          onClose={() => { uiLog().debug('cycle_game.ui.ghost_picker_close', {}); setShowGhostPicker(false); }}
        />
      )}

      {showVolume && (
        <VolumeModal
          volume={masterVolume}
          muted={masterMuted}
          onSetVolume={onSetMasterVolume}
          onClose={() => { uiLog().debug('cycle_game.ui.volume_close', {}); setShowVolume(false); }}
        />
      )}
    </div>
  );
}

CycleGameHome.propTypes = {
  raceType: PropTypes.oneOf(['distance', 'time', null]),
  onSelectRaceType: PropTypes.func,
  raceValue: PropTypes.number,
  onSetRaceValue: PropTypes.func,
  bikes: PropTypes.array,
  people: PropTypes.array,
  onAssign: PropTypes.func,
  onUnassign: PropTypes.func,
  records: PropTypes.array,
  highScores: PropTypes.array,
  onSelectRecord: PropTypes.func,
  ghost: PropTypes.object,
  ghostRoster: PropTypes.arrayOf(PropTypes.shape({
    userId: PropTypes.string.isRequired,
    displayName: PropTypes.string,
    avatarSrc: PropTypes.string,
  })),
  ghostCandidates: PropTypes.array,
  onSelectGhost: PropTypes.func,
  onClearGhost: PropTypes.func,
  masterVolume: PropTypes.number,
  masterMuted: PropTypes.bool,
  onSetMasterVolume: PropTypes.func,
  onStart: PropTypes.func,
  canStart: PropTypes.bool,
  featured: PropTypes.object,
  onRideFeatured: PropTypes.func,
  resolveName: PropTypes.func,
  recoveredNotice: PropTypes.string
};
