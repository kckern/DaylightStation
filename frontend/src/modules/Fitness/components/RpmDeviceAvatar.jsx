import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';

const RpmDeviceAvatar = ({
  rpm = 0,
  animationDuration = '0s',
  baseClassName = 'rpm-device-avatar',
  className = '',
  wrapperClassName = '',
  contentClassName = '',
  imageClassName = '',
  valueClassName = '',
  style,
  spinnerStyle = {},
  valueStyle,
  avatarSrc,
  avatarAlt = '',
  fallbackSrc = '',
  hideSpinnerWhenZero = true,
  showValue = true,
  renderValue
}) => {
  const normalizedRpm = Number.isFinite(rpm) ? Math.max(0, Math.round(rpm)) : null;
  const isZero = !Number.isFinite(normalizedRpm) || normalizedRpm <= 0;
  const displayValue = typeof renderValue === 'function'
    ? renderValue(normalizedRpm, isZero)
    : (isZero ? '' : normalizedRpm);

  const [didFallback, setDidFallback] = useState(false);

  useEffect(() => {
    setDidFallback(false);
  }, [avatarSrc, fallbackSrc]);

  const handleImageError = useCallback((event) => {
    if (!fallbackSrc || didFallback) {
      event.currentTarget.style.display = 'none';
      return;
    }
    setDidFallback(true);
    event.currentTarget.src = fallbackSrc;
  }, [fallbackSrc, didFallback]);

  const rootClassName = [baseClassName, className].filter(Boolean).join(' ') || undefined;
  const wrapperClass = ['rpm-avatar-wrapper', wrapperClassName].filter(Boolean).join(' ');
  const contentClass = ['rpm-avatar-content', contentClassName].filter(Boolean).join(' ');
  const overlayClass = ['rpm-value-overlay', isZero ? 'rpm-zero' : null, valueClassName]
    .filter(Boolean)
    .join(' ');

  const spinnerShouldRender = !(hideSpinnerWhenZero && isZero);
  const composedSpinnerStyle = {
    '--spin-duration': animationDuration,
    ...spinnerStyle
  };

  return (
    <div className={rootClassName} style={style}>
      <div className={wrapperClass}>
        {spinnerShouldRender ? (
          <div className="rpm-spinning-border" style={composedSpinnerStyle} />
        ) : null}
        <div className={contentClass}>
          <img
            src={avatarSrc}
            alt={avatarAlt}
            className={imageClassName}
            onError={handleImageError}
          />
          {showValue ? (
            <div className={overlayClass} style={valueStyle}>
              <span className="rpm-value">{displayValue}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

RpmDeviceAvatar.propTypes = {
  rpm: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  animationDuration: PropTypes.string,
  baseClassName: PropTypes.string,
  className: PropTypes.string,
  wrapperClassName: PropTypes.string,
  contentClassName: PropTypes.string,
  imageClassName: PropTypes.string,
  valueClassName: PropTypes.string,
  style: PropTypes.object,
  spinnerStyle: PropTypes.object,
  valueStyle: PropTypes.object,
  avatarSrc: PropTypes.string,
  avatarAlt: PropTypes.string,
  fallbackSrc: PropTypes.string,
  hideSpinnerWhenZero: PropTypes.bool,
  showValue: PropTypes.bool,
  renderValue: PropTypes.func
};

export default RpmDeviceAvatar;
