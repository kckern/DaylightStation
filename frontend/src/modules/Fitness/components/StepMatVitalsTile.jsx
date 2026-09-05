import React from 'react';
import PropTypes from 'prop-types';
import './StepMatVitalsTile.scss';

/**
 * Fullscreen vitals tile for a pressure mat.
 *
 * Deliberately a rounded SQUARE, not a circle: the circular avatars in this
 * overlay mean "heart rate" and "RPM", and a mat is neither. The silhouette is
 * how it is told apart at garage-display distance.
 *
 * `stomps` is optional. Stomp classification is a firmware judgement that may
 * be withdrawn if it cannot be made to separate hard landings from ordinary
 * steps — passing null drops the cell and leaves a clean steps-only tile,
 * rather than showing a number nobody trusts.
 */
const StepMatVitalsTile = ({
  name,
  avatarSrc,
  fallbackSrc,
  stepsPerMinute,
  sessionSteps,
  sessionStomps = null,
  isInactive = false,
  className = '',
}) => {
  const rate = Number.isFinite(stepsPerMinute) ? Math.round(stepsPerMinute) : 0;
  const steps = Number.isFinite(sessionSteps) ? sessionSteps : 0;
  const stomps = Number.isFinite(sessionStomps) ? sessionStomps : null;

  const label = stomps === null
    ? `${name}: ${rate} steps per minute, ${steps} steps`
    : `${name}: ${rate} steps per minute, ${steps} steps, ${stomps} stomps`;

  return (
    <div
      className={`step-mat-tile ${isInactive ? 'inactive' : ''} ${className}`.trim()}
      role="img"
      aria-label={label}
    >
      <div className="step-mat-tile__face">
        <img
          className="step-mat-tile__avatar"
          src={avatarSrc}
          alt=""
          onError={(event) => {
            if (fallbackSrc && event.currentTarget.src !== fallbackSrc) {
              event.currentTarget.src = fallbackSrc;
            }
          }}
        />
        <div className="step-mat-tile__rate">
          <span className="step-mat-tile__rate-value">{rate}</span>
          <span className="step-mat-tile__rate-unit">SPM</span>
        </div>
      </div>
      <div className="step-mat-tile__totals">
        <span className="step-mat-tile__stat">
          <strong>{steps}</strong>
          <em>steps</em>
        </span>
        {stomps === null ? null : (
          <span className="step-mat-tile__stat">
            <strong>{stomps}</strong>
            <em>stomps</em>
          </span>
        )}
      </div>
    </div>
  );
};

StepMatVitalsTile.propTypes = {
  name: PropTypes.string,
  avatarSrc: PropTypes.string,
  fallbackSrc: PropTypes.string,
  stepsPerMinute: PropTypes.number,
  sessionSteps: PropTypes.number,
  sessionStomps: PropTypes.number,
  isInactive: PropTypes.bool,
  className: PropTypes.string,
};

export default StepMatVitalsTile;
