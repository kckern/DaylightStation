import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import './DeviceAvatar.scss';

/**
 * DeviceAvatar - RPM/spinning device indicator avatar
 * 
 * Migrated from components/RpmDeviceAvatar.jsx
 */
const DeviceAvatar = ({
  rpm = 0,
  animationDuration,
  size = 'md',
  avatarSrc,
  avatarAlt = '',
  fallbackSrc = '',
  hideSpinnerWhenZero = true,
  showValue = true,
  valueFormat,
  className,
  style,
  ...props
}) => {
  const normalizedRpm = Number.isFinite(rpm) ? Math.max(0, Math.round(rpm)) : null;
  const isZero = !Number.isFinite(normalizedRpm) || normalizedRpm <= 0;
  
  // Calculate animation duration from RPM if not provided
  const spinDuration = animationDuration 
    || (normalizedRpm && normalizedRpm > 0 ? `${60 / normalizedRpm}s` : '0s');
  
  const displayValue = typeof valueFormat === 'function'
    ? valueFormat(normalizedRpm, isZero)
    : (normalizedRpm != null ? normalizedRpm : '--');

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

  const spinnerShouldRender = !(hideSpinnerWhenZero && isZero);

  const combinedClassName = [
    'device-avatar',
    `device-avatar--${size}`,
    isZero ? 'device-avatar--idle' : 'device-avatar--active',
    className
  ].filter(Boolean).join(' ');

  return (
    <div className={combinedClassName} style={style} {...props}>
      <div className="device-avatar__wrapper">
        {spinnerShouldRender && (
          <div 
            className="device-avatar__spinner" 
            style={{ '--spin-duration': spinDuration }}
          />
        )}
        <div className="device-avatar__content">
          {avatarSrc && (
            <img
              src={avatarSrc}
              alt={avatarAlt}
              className="device-avatar__image"
              onError={handleImageError}
            />
          )}
          {showValue && (
            <div className="device-avatar__value-overlay">
              <span className="device-avatar__value">{displayValue}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

DeviceAvatar.propTypes = {
  /** RPM value for spinner animation */
  rpm: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  /** Override animation duration (e.g., '2s') */
  animationDuration: PropTypes.string,
  /** Avatar size */
  size: PropTypes.oneOf(['sm', 'md', 'lg', 'xl']),
  /** Avatar image source */
  avatarSrc: PropTypes.string,
  /** Avatar image alt text */
  avatarAlt: PropTypes.string,
  /** Fallback image source */
  fallbackSrc: PropTypes.string,
  /** Hide spinner when RPM is 0 */
  hideSpinnerWhenZero: PropTypes.bool,
  /** Show RPM value */
  showValue: PropTypes.bool,
  /** Custom value formatter (rpm, isZero) => string */
  valueFormat: PropTypes.func,
  /** Additional CSS class */
  className: PropTypes.string,
  /** Additional inline styles */
  style: PropTypes.object
};

export default DeviceAvatar;
