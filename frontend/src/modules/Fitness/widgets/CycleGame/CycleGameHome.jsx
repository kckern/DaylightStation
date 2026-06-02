import React, { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import './CycleGameHome.scss';

const AVATAR_BASE = '/api/v1/static/img/users';
const FALLBACK_AVATAR = `${AVATAR_BASE}/user`;

const DISTANCE_PRESETS_M = [1000, 3000, 5000, 10000];
const TIME_PRESETS_S = [60, 180, 300, 600];

const DISTANCE_STEP_M = 500;
const TIME_STEP_S = 60;

/** Route + finish-flag glyph for the Distance race type. */
function DistanceIcon() {
  return (
    <svg className="cgh-tile__icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        d="M8 40 C 14 30, 6 24, 14 18 C 22 12, 16 8, 24 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="2 5"
      />
      <circle cx="8" cy="40" r="3.5" fill="currentColor" />
      <line x1="32" y1="6" x2="32" y2="42" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M32 8 H44 V18 H32 Z"
        fill="currentColor"
        opacity="0.85"
      />
      <path d="M32 8 H38 V13 H32 Z M38 13 H44 V18 H38 Z" fill="#0e0f13" opacity="0.55" />
    </svg>
  );
}

/** Stopwatch glyph for the Time race type. */
function TimeIcon() {
  return (
    <svg className="cgh-tile__icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <line x1="19" y1="5" x2="29" y2="5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <line x1="24" y1="5" x2="24" y2="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <line x1="37" y1="12" x2="41" y2="8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="24" cy="27" r="15" fill="none" stroke="currentColor" strokeWidth="3" />
      <line x1="24" y1="27" x2="24" y2="17" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <line x1="24" y1="27" x2="31" y2="31" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function formatDistance(meters) {
  const m = Math.max(0, Math.round(meters || 0));
  if (m >= 1000) {
    const km = m / 1000;
    return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
  }
  return `${m} m`;
}

function formatTime(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  if (s % 60 === 0) return `${s / 60} min`;
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Race-type dichotomy + value step. Two prominent SVG tiles (Distance / Time);
 * once a type is chosen, a value step (presets + stepper) is revealed.
 */
function RaceTypePicker({ raceType, onSelectRaceType, raceValue, onSetRaceValue }) {
  const isDistance = raceType === 'distance';
  const isTime = raceType === 'time';

  const presets = isTime ? TIME_PRESETS_S : DISTANCE_PRESETS_M;
  const step = isTime ? TIME_STEP_S : DISTANCE_STEP_M;
  const minValue = step;
  const fmt = isTime ? formatTime : formatDistance;
  const value = Number.isFinite(raceValue) ? raceValue : null;

  return (
    <section className="cgh-race">
      <div className="cgh-section-label">Race type</div>
      <div className="cgh-tiles">
        <button
          type="button"
          className={`cgh-tile${isDistance ? ' is-selected' : ''}`}
          data-testid="course-distance"
          aria-pressed={isDistance}
          onClick={() => onSelectRaceType?.('distance')}
        >
          <DistanceIcon />
          <span className="cgh-tile__name">Distance</span>
          <span className="cgh-tile__hint">First to the line</span>
        </button>
        <button
          type="button"
          className={`cgh-tile${isTime ? ' is-selected' : ''}`}
          data-testid="course-time"
          aria-pressed={isTime}
          onClick={() => onSelectRaceType?.('time')}
        >
          <TimeIcon />
          <span className="cgh-tile__name">Time</span>
          <span className="cgh-tile__hint">Furthest in the clock</span>
        </button>
      </div>

      {raceType && (
        <div className="cgh-value" data-testid="cgh-value">
          <div className="cgh-section-label cgh-section-label--sub">
            {isDistance ? 'How far?' : 'How long?'}
          </div>
          <div className="cgh-value__row">
            <div className="cgh-presets">
              {presets.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`cgh-preset${value === p ? ' is-selected' : ''}`}
                  onClick={() => onSetRaceValue?.(p)}
                >
                  {fmt(p)}
                </button>
              ))}
            </div>
            <div className="cgh-stepper" role="group" aria-label="Custom value">
              <button
                type="button"
                className="cgh-stepper__btn"
                aria-label="decrease"
                disabled={value != null && value <= minValue}
                onClick={() => onSetRaceValue?.(Math.max(minValue, (value ?? presets[0]) - step))}
              >
                −
              </button>
              <span className="cgh-stepper__value">{value != null ? fmt(value) : 'default'}</span>
              <button
                type="button"
                className="cgh-stepper__btn"
                aria-label="increase"
                onClick={() => onSetRaceValue?.((value ?? presets[0]) + step)}
              >
                +
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

RaceTypePicker.propTypes = {
  raceType: PropTypes.oneOf(['distance', 'time', null]),
  onSelectRaceType: PropTypes.func,
  raceValue: PropTypes.number,
  onSetRaceValue: PropTypes.func
};

/** Modal sheet for picking a registered user to assign to a bike. */
function RiderPicker({ bike, people = [], onAssign, onClose }) {
  return (
    <div className="cgh-picker" role="dialog" aria-modal="true" data-testid="rider-picker">
      <div className="cgh-picker__backdrop" onClick={onClose} />
      <div className="cgh-picker__sheet">
        <div className="cgh-picker__head">
          <div>
            <div className="cgh-section-label cgh-section-label--sub">Assign rider</div>
            <div className="cgh-picker__bike">{bike?.name || bike?.id}</div>
          </div>
          <button type="button" className="cgh-picker__close" aria-label="close" onClick={onClose}>×</button>
        </div>
        {people.length === 0 && <div className="cgh-empty">No registered users</div>}
        <div className="cgh-picker__grid">
          {people.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`cgh-person${p.hasHR ? ' has-hr' : ''}`}
              data-testid={`assign-${p.id}`}
              onClick={() => onAssign?.(bike.id, p.id)}
            >
              <CircularUserAvatar
                name={p.name}
                avatarSrc={p.avatarSrc}
                fallbackSrc={FALLBACK_AVATAR}
                heartRate={Number.isFinite(p.heartRate) ? p.heartRate : undefined}
                zoneId={p.zoneId || undefined}
                zoneColor={p.zoneColor || undefined}
                size={64}
                showGauge={p.hasHR}
                showIndicator={false}
              />
              <span className="cgh-person__name">{p.name}</span>
              {p.hasHR && <span className="cgh-person__badge">live</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

RiderPicker.propTypes = {
  bike: PropTypes.object,
  people: PropTypes.array,
  onAssign: PropTypes.func,
  onClose: PropTypes.func
};

/** A single bike slot in the starting grid. */
function BikeSlot({ bike, person, onPick, onUnassign }) {
  const filled = !!person;
  return (
    <div className={`cgh-slot${filled ? ' is-filled' : ''}`} data-testid={`bike-${bike.id}`}>
      <button
        type="button"
        className="cgh-slot__main"
        onClick={() => onPick?.(bike)}
        aria-label={filled ? `Reassign ${bike.name}` : `Assign rider to ${bike.name}`}
      >
        {filled ? (
          <CircularUserAvatar
            name={person.name}
            avatarSrc={person.avatarSrc}
            fallbackSrc={FALLBACK_AVATAR}
            heartRate={Number.isFinite(person.heartRate) ? person.heartRate : undefined}
            zoneId={person.zoneId || undefined}
            zoneColor={person.zoneColor || undefined}
            progress={Number.isFinite(person.progress) ? person.progress : undefined}
            size={72}
            showGauge={person.hasHR}
          />
        ) : (
          <div className="cgh-slot__empty" aria-hidden="true">
            <svg viewBox="0 0 48 48" className="cgh-slot__plus" focusable="false">
              <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 5" />
              <line x1="24" y1="15" x2="24" y2="33" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              <line x1="15" y1="24" x2="33" y2="24" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </div>
        )}
      </button>
      <div className="cgh-slot__label">{bike.name}</div>
      <div className="cgh-slot__rider">
        {filled ? (
          <button type="button" className="cgh-slot__clear" onClick={() => onUnassign?.(bike.id)}>
            {person.name} · remove
          </button>
        ) : (
          <span className="cgh-slot__tap">tap to assign</span>
        )}
      </div>
    </div>
  );
}

BikeSlot.propTypes = {
  bike: PropTypes.object.isRequired,
  person: PropTypes.object,
  onPick: PropTypes.func,
  onUnassign: PropTypes.func
};

/**
 * Cycle-game home (the `idle` lifecycle state). A designed lobby: race-type
 * dichotomy (Distance vs Time) with a second-order value step, a starting grid
 * of bikes with on-screen rider assignment, and a separate Records rail. Fully
 * prop-driven; the container supplies data + handlers.
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
  onStart,
  canStart = false
}) {
  const [pickerBike, setPickerBike] = useState(null);

  const peopleById = useMemo(() => {
    const map = new Map();
    people.forEach((p) => map.set(p.id, p));
    return map;
  }, [people]);

  const assignedCount = bikes.filter((b) => b.rider).length;

  const handleAssign = (bikeId, userId) => {
    onAssign?.(bikeId, userId);
    setPickerBike(null);
  };

  return (
    <div className="cycle-game-home" data-testid="cycle-game-home">
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
        />

        <section className="cgh-grid-section">
          <div className="cgh-section-label">
            Starting grid
            {bikes.length > 0 && (
              <span className="cgh-section-count">{assignedCount}/{bikes.length} riders</span>
            )}
          </div>
          {bikes.length === 0 ? (
            <div className="cgh-empty">No bikes detected (equipment with a cadence sensor).</div>
          ) : (
            <div className="cgh-grid">
              {bikes.map((bike) => (
                <BikeSlot
                  key={bike.id}
                  bike={bike}
                  person={bike.rider ? peopleById.get(bike.rider) || { id: bike.rider, name: bike.rider } : null}
                  onPick={setPickerBike}
                  onUnassign={onUnassign}
                />
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
            Start race
          </button>
        </div>
      </div>

      <aside className="cycle-game-home__records" data-testid="cycle-game-records">
        <div className="cgh-section-label">Records</div>
        {records.length === 0 ? (
          <div className="cgh-empty">No races yet</div>
        ) : (
          <ol className="cgh-records">
            {records.map((rec, i) => (
              <li key={`${rec.courseId || rec.type || 'r'}-${rec.userId || i}-${i}`} className="cgh-record">
                <span className="cgh-record__rank">{i + 1}</span>
                <span className="cgh-record__label">{rec.label}</span>
              </li>
            ))}
          </ol>
        )}
      </aside>

      {pickerBike && (
        <RiderPicker
          bike={pickerBike}
          people={people}
          onAssign={handleAssign}
          onClose={() => setPickerBike(null)}
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
  onStart: PropTypes.func,
  canStart: PropTypes.bool
};
