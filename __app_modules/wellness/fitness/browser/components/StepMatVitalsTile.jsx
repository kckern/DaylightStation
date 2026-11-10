import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { StepMatGlyph } from "../shared/EquipmentGlyph.jsx";
import "./StepMatVitalsTile.scss";

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
 *
 * The face shows `avatarSrc` (the rider who claimed the mat, or a declared
 * equipment photo). With no source, or when the image fails, it draws the
 * step-mat glyph — never the generic equipment picture.
 */
const StepMatVitalsTile = ({
  name,
  avatarSrc,
  stepsPerMinute,
  sessionSteps,
  sessionStomps = null,
  isInactive = false,
  className = '',
}) => {
  const rate = Number.isFinite(stepsPerMinute) ? Math.round(stepsPerMinute) : 0;
  const steps = Number.isFinite(sessionSteps) ? sessionSteps : 0;
  const stomps = Number.isFinite(sessionStomps) ? sessionStomps : null;
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => { setImageFailed(false); }, [avatarSrc]);
  const showImage = Boolean(avatarSrc) && !imageFailed;

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
        {showImage ? (
          <img
            className="step-mat-tile__avatar"
            src={avatarSrc}
            alt=""
            onError={() => setImageFailed(true)}
          />
        ) : (
          <StepMatGlyph className="step-mat-tile__glyph" />
        )}
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
  stepsPerMinute: PropTypes.number,
  sessionSteps: PropTypes.number,
  sessionStomps: PropTypes.number,
  isInactive: PropTypes.bool,
  className: PropTypes.string,
};

export default StepMatVitalsTile;
