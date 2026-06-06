import React from 'react';
import PropTypes from 'prop-types';
import { DistanceIcon, TimeIcon, GhostIcon } from './icons.jsx';
import { formatDistance, formatTime } from './formatters.js';
import { DISTANCE_TIERS, TIME_TIERS, DEFAULT_TIER_KEY, DISTANCE_STEP_M, TIME_STEP_S } from './constants.js';
import './RaceTypePicker.scss';

/**
 * Race-type trichotomy: Distance / Time / Ghost. Distance & Time reveal a value
 * step (presets + stepper, a preset pre-chosen — never "default"). Ghost opens
 * the ghost picker; the chosen recording determines its own config, shown as a
 * summary in place of the value step.
 */
export function RaceTypePicker({ raceType, onSelectRaceType, raceValue, onSetRaceValue, ghost, onPickGhost, onClearGhost }) {
  const hasGhost = !!ghost;
  const isDistance = !hasGhost && raceType === 'distance';
  const isTime = !hasGhost && raceType === 'time';

  const tiers = raceType === 'time' ? TIME_TIERS : DISTANCE_TIERS;
  const step = raceType === 'time' ? TIME_STEP_S : DISTANCE_STEP_M;
  const minValue = step;
  const fmt = raceType === 'time' ? formatTime : formatDistance;
  const defaultTierValue = (tiers.find((t) => t.key === DEFAULT_TIER_KEY) || tiers[0]).value;
  // Effective value: the chosen value, or the default (Medium) tier.
  const value = Number.isFinite(raceValue) ? raceValue : defaultTierValue;

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
                {tiers.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    data-testid={`tier-${t.key}`}
                    className={`cgh-preset cgh-preset--tier${value === t.value ? ' is-selected' : ''}`}
                    onClick={() => onSetRaceValue?.(t.value)}
                  >
                    <span className="cgh-preset__name">{t.label}</span>
                    <span className="cgh-preset__value">{fmt(t.value)}</span>
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

export default RaceTypePicker;
