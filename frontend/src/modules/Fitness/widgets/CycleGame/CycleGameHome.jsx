import React, { useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import RpmDeviceAvatar from '@/modules/Fitness/components/RpmDeviceAvatar.jsx';
import { DaylightMediaPath } from '@/lib/api.mjs';
import './CycleGameHome.scss';

const EQUIPMENT_FALLBACK = DaylightMediaPath('/static/img/equipment/equipment');

const AVATAR_BASE = '/api/v1/static/img/users';
const FALLBACK_AVATAR = `${AVATAR_BASE}/user`;

const DISTANCE_PRESETS_M = [1000, 3000, 5000, 10000];
const TIME_PRESETS_S = [60, 120, 300, 600];

const DISTANCE_STEP_M = 500;
const TIME_STEP_S = 60;

/** Map-pins-and-route glyph for the Distance race type (svgrepo 447602). */
function DistanceIcon() {
  return (
    <svg className="cgh-tile__icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true" focusable="false">
      <path d="M17.94,54.81a.1.1,0,0,1-.14,0c-1-1.11-11.69-13.23-11.69-21.26,0-9.94,6.5-12.24,11.76-12.24,4.84,0,11.06,2.6,11.06,12.24C28.93,41.84,18.87,53.72,17.94,54.81Z" />
      <circle cx="17.52" cy="31.38" r="4.75" />
      <path d="M49.58,34.77a.11.11,0,0,1-.15,0c-.87-1-9.19-10.45-9.19-16.74,0-7.84,5.12-9.65,9.27-9.65,3.81,0,8.71,2,8.71,9.65C58.22,24.52,50.4,33.81,49.58,34.77Z" />
      <circle cx="49.23" cy="17.32" r="3.75" />
      <path d="M17.87,54.89a28.73,28.73,0,0,0,3.9.89" />
      <path d="M24.68,56.07c2.79.12,5.85-.28,7.9-2.08,5.8-5.09,2.89-11.25,6.75-14.71a16.72,16.72,0,0,1,4.93-3" strokeDasharray="7.8 2.92" />
      <path d="M45.63,35.8a23,23,0,0,1,3.88-.95" />
    </svg>
  );
}

/** Stopwatch glyph for the Time race type (svgrepo 532129). */
function TimeIcon() {
  return (
    <svg className="cgh-tile__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M12 14V11M12 6C7.85786 6 4.5 9.35786 4.5 13.5C4.5 17.6421 7.85786 21 12 21C16.1421 21 19.5 17.6421 19.5 13.5C19.5 11.5561 18.7605 9.78494 17.5474 8.4525M12 6C14.1982 6 16.1756 6.94572 17.5474 8.4525M12 6V3M19.5 6.5L17.5474 8.4525M12 3H9M12 3H15"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

/** Ghost glyph for the Ghost race type (svgrepo 507709). */
function GhostIcon() {
  return (
    <svg className="cgh-tile__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M12 3C7.02944 3 3 7.02944 3 12V19.0093C3 20.7408 5.05088 21.6542 6.33793 20.4959L6.98682 19.9119C7.59805 19.3618 8.48368 19.2418 9.21918 19.6096L11.1056 20.5528C11.6686 20.8343 12.3314 20.8343 12.8944 20.5528L14.7808 19.6096C15.5163 19.2418 16.402 19.3618 17.0132 19.9119L17.6621 20.4959C18.9491 21.6542 21 20.7408 21 19.0093V12C21 7.02944 16.9706 3 12 3Z" stroke="currentColor" strokeWidth="2" />
      <path d="M8 14C8.91221 15.2144 10.3645 16 12.0004 16C13.6362 16 15.0885 15.2144 16.0007 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M9 10.0112V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M15 10.0112V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Checkered race-flag glyph for the Start button (svgrepo 3532). */
function RaceFlagIcon() {
  return (
    <svg className="cgh-start-flag" viewBox="0 0 37.979 37.979" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M21.553,2.322C15.45,3.435,9.956,6.693,2.608,3.406c0.096,0.333,0.189,0.667,0.283,1h-1.75L1,3.906H0l8.988,31.75h1l-4.01-14.167h1.75c0.109,0.39,0.221,0.778,0.33,1.168C15.405,25.942,20.9,22.684,27,21.571C25.186,15.155,23.369,8.738,21.553,2.322z M9.796,5.831c2.07-0.046,4.032-0.473,5.971-0.983c0.521,1.833,1.039,3.667,1.559,5.5c-1.938,0.51-3.901,0.937-5.973,0.983C10.834,9.497,10.314,7.664,9.796,5.831z M5.766,20.739L1.354,5.156h1.75c1.472,5.194,2.941,10.389,4.412,15.583H5.766z M7.173,15.991c-0.508-1.792-1.017-3.583-1.522-5.375c2.046,0.751,3.951,1.005,5.773,0.964c0.507,1.792,1.015,3.583,1.521,5.375C11.125,16.996,9.219,16.742,7.173,15.991z M20.651,22.098c-1.938,0.511-3.9,0.937-5.972,0.982c-0.519-1.834-1.038-3.667-1.558-5.5c2.069-0.046,4.032-0.473,5.973-0.983C19.613,18.432,20.133,20.264,20.651,22.098z M24.039,14.635c-1.729,0.375-3.414,0.889-5.121,1.337c-0.508-1.792-1.016-3.583-1.521-5.375c1.706-0.449,3.395-0.962,5.12-1.337C23.023,11.052,23.531,12.843,24.039,14.635z M23.227,5.446c0.096,0.333,0.189,0.667,0.283,1c0.787-0.118,1.584-0.195,2.398-0.213c0.52,1.833,1.037,3.667,1.557,5.5c-0.813,0.018-1.611,0.095-2.396,0.213c0.591,2.083,1.181,4.167,1.771,6.25c0.785-0.118,1.584-0.195,2.396-0.213c0.521,1.833,1.039,3.667,1.56,5.5c-2.07,0.045-4.033,0.473-5.974,0.981c-0.121-0.432-0.243-0.86-0.364-1.291c-2.018,0.529-4.008,1.15-6.068,1.525c0.217,0.766,0.434,1.529,0.649,2.293c6.101-1.113,11.597-4.371,18.94-1.086c-1.814-6.416-3.633-12.833-5.449-19.25C29.11,5.128,26.094,5.015,23.227,5.446z M34.833,18.322c-2.046-0.751-3.95-1.005-5.772-0.964c-0.508-1.792-1.016-3.583-1.521-5.375c1.82-0.041,3.727,0.213,5.771,0.964C33.817,14.739,34.326,16.53,34.833,18.322z" />
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
 * Race-type trichotomy: Distance / Time / Ghost. Distance & Time reveal a value
 * step (presets + stepper, a preset pre-chosen — never "default"). Ghost opens
 * the ghost picker; the chosen recording determines its own config, shown as a
 * summary in place of the value step.
 */
function RaceTypePicker({ raceType, onSelectRaceType, raceValue, onSetRaceValue, ghost, onPickGhost, onClearGhost }) {
  const hasGhost = !!ghost;
  const isDistance = !hasGhost && raceType === 'distance';
  const isTime = !hasGhost && raceType === 'time';

  const presets = raceType === 'time' ? TIME_PRESETS_S : DISTANCE_PRESETS_M;
  const step = raceType === 'time' ? TIME_STEP_S : DISTANCE_STEP_M;
  const minValue = step;
  const fmt = raceType === 'time' ? formatTime : formatDistance;
  // Effective value: the chosen value, or the sensible pre-selected preset.
  const value = Number.isFinite(raceValue) ? raceValue : presets[1];

  const ghostSummary = hasGhost
    ? (ghost.winCondition === 'time'
        ? `Time · ${formatTime(ghost.timeCapS || 0)}`
        : `Distance · ${formatDistance(ghost.goalM || 0)}`)
    : null;

  return (
    <section className="cgh-race">
      <div className="cgh-section-label">Race type</div>
      <div className="cgh-tiles cgh-tiles--three">
        <button
          type="button"
          className={`cgh-tile${isDistance ? ' is-selected' : ''}`}
          data-testid="course-distance"
          aria-pressed={isDistance}
          onClick={() => onSelectRaceType?.('distance')}
        >
          <DistanceIcon />
          <span className="cgh-tile__text">
            <span className="cgh-tile__name">Distance</span>
            <span className="cgh-tile__hint">First to the line</span>
          </span>
        </button>
        <button
          type="button"
          className={`cgh-tile${isTime ? ' is-selected' : ''}`}
          data-testid="course-time"
          aria-pressed={isTime}
          onClick={() => onSelectRaceType?.('time')}
        >
          <TimeIcon />
          <span className="cgh-tile__text">
            <span className="cgh-tile__name">Time</span>
            <span className="cgh-tile__hint">Furthest in the clock</span>
          </span>
        </button>
        <button
          type="button"
          className={`cgh-tile cgh-tile--ghost${hasGhost ? ' is-selected' : ''}`}
          data-testid="course-ghost"
          aria-pressed={hasGhost}
          onClick={() => onPickGhost?.()}
        >
          <GhostIcon />
          <span className="cgh-tile__text">
            <span className="cgh-tile__name">Ghost</span>
            <span className="cgh-tile__hint">Chase a past race</span>
          </span>
        </button>
      </div>

      {/* Reserved-height slot so revealing the value step never shoves the
          starting grid downward (no layout "rug pull"). */}
      <div className="cgh-value-slot">
        {hasGhost ? (
          <div className="cgh-ghost-summary" data-testid="cgh-ghost-summary">
            <span className="cgh-ghost-summary__icon" aria-hidden="true">👻</span>
            <span className="cgh-ghost-summary__text">
              <span className="cgh-ghost-summary__vs">vs {ghost.displayName}</span>
              <span className="cgh-ghost-summary__meta">{ghostSummary}</span>
            </span>
            <button type="button" className="cgh-ghost-summary__btn" onClick={() => onPickGhost?.()}>Change</button>
            <button type="button" className="cgh-ghost-summary__btn cgh-ghost-summary__btn--clear" onClick={() => onClearGhost?.()}>Remove</button>
          </div>
        ) : raceType ? (
          <div className="cgh-value" data-testid="cgh-value" key={raceType}>
            <div className="cgh-section-label cgh-section-label--sub">
              {raceType === 'distance' ? 'How far?' : 'How long?'}
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
                  disabled={value <= minValue}
                  onClick={() => onSetRaceValue?.(Math.max(minValue, value - step))}
                >
                  −
                </button>
                <span className="cgh-stepper__value">{fmt(value)}</span>
                <button
                  type="button"
                  className="cgh-stepper__btn"
                  aria-label="increase"
                  onClick={() => onSetRaceValue?.(value + step)}
                >
                  +
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="cgh-value-hint" aria-hidden="true">
            Pick Distance, Time, or a Ghost to set the goal
          </div>
        )}
      </div>
    </section>
  );
}

RaceTypePicker.propTypes = {
  raceType: PropTypes.oneOf(['distance', 'time', null]),
  onSelectRaceType: PropTypes.func,
  raceValue: PropTypes.number,
  onSetRaceValue: PropTypes.func,
  ghost: PropTypes.object,
  onPickGhost: PropTypes.func,
  onClearGhost: PropTypes.func
};

/**
 * Modal sheet for picking a registered user to assign to a bike. Household
 * members show on the main tab; guests live behind a separate tab. When the
 * slot already has a rider, a Clear tile is offered.
 */
const PICKER_CATEGORIES = [
  { key: 'household', label: 'Household' },
  { key: 'family', label: 'Family' },
  { key: 'guest', label: 'Guests' }
];

function categoryOf(p) {
  if (p.category) return p.category;
  return p.isGuest ? 'guest' : 'household';
}

function RiderPicker({ bike, people = [], currentRiderId = null, onAssign, onClear, onClose }) {
  const available = PICKER_CATEGORIES.filter(
    (c) => people.some((p) => categoryOf(p) === c.key)
  );
  const [tab, setTab] = useState(available[0]?.key || 'household');
  const activeTab = available.some((c) => c.key === tab) ? tab : (available[0]?.key || 'household');
  // Native anonymous guests (Adult / Kid) lead their tab; others keep their order.
  const list = people
    .filter((p) => categoryOf(p) === activeTab)
    .sort((a, b) => (b.native ? 1 : 0) - (a.native ? 1 : 0));
  const showTabs = available.length > 1;

  const renderPerson = (p) => (
    <button
      key={p.id}
      type="button"
      className={`cgh-person${p.hasHR ? ' has-hr' : ''}${p.id === currentRiderId ? ' is-current' : ''}`}
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
  );

  return (
    <div className="cgh-picker" role="dialog" aria-modal="true" data-testid="rider-picker">
      <div className="cgh-picker__backdrop" onClick={onClose} />
      <div className="cgh-picker__sheet">
        <div className="cgh-picker__head">
          <div className="cgh-picker__heading">
            <div className="cgh-section-label cgh-section-label--sub">Assign rider</div>
            <div className="cgh-picker__bike">{bike?.name || bike?.id}</div>
          </div>
          <button type="button" className="cgh-picker__close" aria-label="close" onClick={onClose}>×</button>
        </div>

        {showTabs && (
          <div className="cgh-picker__tabs" role="tablist">
            {available.map((c) => (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={activeTab === c.key}
                className={`cgh-tab${activeTab === c.key ? ' is-active' : ''}`}
                onClick={() => setTab(c.key)}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        <div className="cgh-picker__grid">
          {currentRiderId && (
            <button
              type="button"
              className="cgh-person cgh-person--clear"
              data-testid="rider-clear"
              onClick={() => onClear?.(bike.id)}
            >
              <span className="cgh-person__clear-glyph" aria-hidden="true">×</span>
              <span className="cgh-person__name">Clear</span>
            </button>
          )}
          {list.map(renderPerson)}
        </div>
        {list.length === 0 && (
          <div className="cgh-empty">No registered users</div>
        )}
      </div>
    </div>
  );
}

RiderPicker.propTypes = {
  bike: PropTypes.object,
  people: PropTypes.array,
  currentRiderId: PropTypes.string,
  onAssign: PropTypes.func,
  onClear: PropTypes.func,
  onClose: PropTypes.func
};

/**
 * A single bike slot in the starting grid. The equipment icon is always the
 * hero; an assigned rider's avatar overlaps the bottom-right quadrant as a
 * secondary circle. Clicking the slot (empty OR filled) opens the rider picker.
 */
function BikeSlot({ bike, person, onPick }) {
  const filled = !!person;
  const rpm = Number.isFinite(bike.rpm) ? bike.rpm : 0;
  const spinDuration = rpm > 0 ? `${(60 / rpm).toFixed(2)}s` : '0s';
  return (
    <div className={`cgh-slot${filled ? ' is-filled' : ''}`} data-testid={`bike-${bike.id}`}>
      <button
        type="button"
        className="cgh-slot__main"
        onClick={() => onPick?.(bike)}
        aria-label={filled ? `Change rider for ${bike.name}` : `Assign rider to ${bike.name}`}
      >
        <RpmDeviceAvatar
          className="cgh-slot__device"
          avatarSrc={bike.iconSrc}
          avatarAlt={bike.name}
          fallbackSrc={EQUIPMENT_FALLBACK}
          rpm={rpm}
          animationDuration={spinDuration}
          showValue
          renderValue={(v, isZero) => (isZero ? '' : v)}
          hideSpinnerWhenZero
        />
        {filled && (
          <span className="cgh-slot__rider-avatar">
            <CircularUserAvatar
              name={person.name}
              avatarSrc={person.avatarSrc}
              fallbackSrc={FALLBACK_AVATAR}
              heartRate={Number.isFinite(person.heartRate) ? person.heartRate : undefined}
              zoneId={person.zoneId || undefined}
              zoneColor={person.zoneColor || undefined}
              progress={Number.isFinite(person.progress) ? person.progress : undefined}
              size={48}
              showGauge={person.hasHR}
              showIndicator={false}
            />
          </span>
        )}
      </button>
    </div>
  );
}

BikeSlot.propTypes = {
  bike: PropTypes.object.isRequired,
  person: PropTypes.object,
  onPick: PropTypes.func
};

/** Header label for a day column: Today / Yesterday / weekday + date. */
function formatDayHeader(day) {
  if (!day || day === 'unknown') return 'Earlier';
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const y = new Date(now.getTime() - 86400000);
  const yestStr = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;
  if (day === todayStr) return 'Today';
  if (day === yestStr) return 'Yesterday';
  const [yr, mo, d] = day.split('-').map(Number);
  return new Date(yr, mo - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * Ghost picker — past races grouped into day columns (most recent 3 days on
 * file). Two-stage selection for remote/kiosk: the first tap scrolls a card
 * into view + focuses it; a second tap on the focused card commits it. The
 * score (what you race against) is the prominent figure; the goal is context.
 */
function GhostPicker({ candidates = [], currentGhost = null, onSelect, onClear, onClose }) {
  const [focusedId, setFocusedId] = useState(currentGhost?.sourceRaceId || null);
  const cardRefs = useRef({});

  const columns = useMemo(() => {
    const map = new Map();
    [...candidates]
      .sort((a, b) => String(b.raceId).localeCompare(String(a.raceId)))
      .forEach((c) => {
        if (!map.has(c.day)) map.set(c.day, []);
        map.get(c.day).push(c);
      });
    return [...map.entries()].slice(0, 3); // most recent 3 days
  }, [candidates]);

  const handleTap = (c) => {
    if (focusedId !== c.raceId) {
      setFocusedId(c.raceId);
      const el = cardRefs.current[c.raceId];
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      onSelect?.(c);
    }
  };

  return (
    <div className="cgh-picker cgh-picker--ghost" role="dialog" aria-modal="true" data-testid="ghost-picker">
      <div className="cgh-picker__backdrop" onClick={onClose} />
      <div className="cgh-picker__sheet">
        <div className="cgh-picker__head">
          <div className="cgh-picker__heading">
            <div className="cgh-section-label cgh-section-label--sub">Race a ghost</div>
            <div className="cgh-picker__bike">Chase a past race · tap to focus, tap again to choose</div>
          </div>
          <button type="button" className="cgh-picker__close" aria-label="close" onClick={onClose}>×</button>
        </div>

        {columns.length === 0 ? (
          <div className="cgh-empty">No past races yet — finish a race to create a ghost.</div>
        ) : (
          <div className="cgh-ghost-cols">
            {columns.map(([day, races]) => (
              <div className="cgh-ghost-col" key={day}>
                <div className="cgh-ghost-col__date">{formatDayHeader(day)}</div>
                <div className="cgh-ghost-col__list">
                  {races.map((c) => {
                    const isCurrent = currentGhost && currentGhost.sourceRaceId === c.raceId;
                    const isFocused = focusedId === c.raceId;
                    const riders = c.participants || [];
                    return (
                      <button
                        key={c.raceId}
                        ref={(el) => { cardRefs.current[c.raceId] = el; }}
                        type="button"
                        className={`cgh-ghost-card${isFocused ? ' is-focused' : ''}${isCurrent ? ' is-current' : ''}`}
                        data-testid={`ghost-${c.raceId}`}
                        onClick={() => handleTap(c)}
                      >
                        <span className="cgh-ghost-card__avatars" data-count={Math.min(riders.length, 4)}>
                          {riders.slice(0, 4).map((p) => (
                            <img
                              key={p.id}
                              className="cgh-ghost-card__avatar"
                              src={p.avatarSrc}
                              alt={p.displayName}
                              title={p.displayName}
                              onError={(e) => { e.currentTarget.src = FALLBACK_AVATAR; }}
                            />
                          ))}
                        </span>
                        <span className="cgh-ghost-card__info">
                          <span className="cgh-ghost-card__score">{c.scoreLabel}</span>
                          <span className="cgh-ghost-card__goal">{c.scoreKind === 'time' ? 'in' : 'to'} {c.goalLabel}</span>
                          <span className="cgh-ghost-card__time">{c.timeOfDay}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {currentGhost && (
          <button
            type="button"
            className="cgh-ghost-clear"
            data-testid="ghost-clear"
            onClick={() => { onClear?.(); onClose?.(); }}
          >
            Remove ghost
          </button>
        )}
      </div>
    </div>
  );
}

GhostPicker.propTypes = {
  candidates: PropTypes.array,
  currentGhost: PropTypes.object,
  onSelect: PropTypes.func,
  onClear: PropTypes.func,
  onClose: PropTypes.func
};

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
  ghost = null,
  ghostCandidates = [],
  onSelectGhost,
  onClearGhost,
  onStart,
  canStart = false
}) {
  const [pickerBike, setPickerBike] = useState(null);
  const [showGhostPicker, setShowGhostPicker] = useState(false);

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
          onPickGhost={() => setShowGhostPicker(true)}
          onClearGhost={onClearGhost}
        />

        <section className="cgh-grid-section">
          <div className="cgh-section-label">Starting grid</div>
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
            <RaceFlagIcon />
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
              <li key={`${rec.raceId || i}`} className="cgh-record">
                <span className="cgh-record__avatars">
                  {(rec.avatars || []).map((a) => (
                    <img
                      key={a.id}
                      className="cgh-record__avatar"
                      src={a.src}
                      alt={a.name}
                      title={a.name}
                      onError={(e) => { e.currentTarget.src = FALLBACK_AVATAR; }}
                    />
                  ))}
                </span>
                <span className="cgh-record__stats">
                  <span className="cgh-record__chip" data-kind={rec.goalKind}>
                    🏁 {rec.goalLabel}
                  </span>
                  <span className="cgh-record__score">{rec.scoreLabel}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </aside>

      {pickerBike && (
        <RiderPicker
          bike={pickerBike}
          people={people}
          currentRiderId={pickerBike.rider || null}
          onAssign={handleAssign}
          onClear={handleClear}
          onClose={() => setPickerBike(null)}
        />
      )}

      {showGhostPicker && (
        <GhostPicker
          candidates={ghostCandidates}
          currentGhost={ghost}
          onSelect={(g) => { onSelectGhost?.(g); setShowGhostPicker(false); }}
          onClear={() => { onClearGhost?.(); }}
          onClose={() => setShowGhostPicker(false)}
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
  ghost: PropTypes.object,
  ghostCandidates: PropTypes.array,
  onSelectGhost: PropTypes.func,
  onClearGhost: PropTypes.func,
  onStart: PropTypes.func,
  canStart: PropTypes.bool
};
