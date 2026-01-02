import React from 'react';
import PropTypes from 'prop-types';
import './CircularUserAvatar.scss';

const GAUGE_RADIUS = 47;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;

const clamp = (value, min, max) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.min(Math.max(value, min), max);
};

const formatSize = (size) => {
  if (size == null) return undefined;
  if (typeof size === 'number') return `${size}px`;
  return String(size);
};

const formatRingWidth = (width) => {
  if (width == null) return undefined;
  if (typeof width === 'number') return `${width}px`;
  return String(width);
};

const CircularUserAvatar = ({
  name,
  avatarSrc,
  fallbackSrc,
  heartRate,
  zoneId,
  zoneColor,
  progress,
  size,
  ringWidth,
  className = '',
  style,
  showGauge = true,
  showIndicator = true,
  opacity,
  ariaLabel,
  children,
  onClick,
  role
}) => {
  const isFireZone = zoneId === 'fire';
  //if fire, showIndicator is false
  if (isFireZone) {
    showIndicator = false;
  }
  const normalizedProgress = clamp(progress, 0, 1);
  const indicatorAngle = normalizedProgress !== null
    ? 180 + normalizedProgress * 180
    : null;
  const strokeDashoffset = normalizedProgress !== null
    ? GAUGE_CIRCUMFERENCE * (1 - indicatorAngle / 360)
    : GAUGE_CIRCUMFERENCE;

  const rootStyle = {
    ...style,
    '--vital-ring-color': zoneColor || style?.['--vital-ring-color'],
    '--vital-avatar-size': formatSize(size) || style?.['--vital-avatar-size'],
    '--vital-ring-width': formatRingWidth(ringWidth) || style?.['--vital-ring-width']
  };

  if (Number.isFinite(opacity)) {
    rootStyle.opacity = opacity;
  }

  Object.keys(rootStyle).forEach((key) => {
    if (rootStyle[key] == null) {
      delete rootStyle[key];
    }
  });

  const combinedClassName = [
    'circular-user-avatar',
    'vital-avatar',
    zoneId ? `zone-${zoneId}` : null,
    className
  ].filter(Boolean).join(' ');

  const resolvedAriaLabel = ariaLabel || (name ? `${name} vitals` : undefined);

  const handleImageError = (event) => {
    const img = event.currentTarget;
    if (!fallbackSrc) {
      img.style.display = 'none';
      return;
    }
    if (img.dataset.fallback) {
      img.style.display = 'none';
      return;
    }
    img.dataset.fallback = '1';
    img.src = fallbackSrc;
  };

  return (
    <div
      className={combinedClassName}
      style={rootStyle}
      aria-label={resolvedAriaLabel}
      role={role}
      onClick={onClick}
    >
      {/* Fire sunbeams effect */}
      {isFireZone && (
        <div className="fire-sunbeams" aria-hidden="true">
          {[...Array(12)].map((_, i) => (
            <div
              key={i}
              className="sunbeam"
              style={{ '--beam-index': i }}
            />
          ))}
        </div>
      )}

      {showGauge && (
        <svg
          className="zone-progress-gauge"
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          <circle
            className="gauge-arc gauge-arc-track"
            cx="50"
            cy="50"
            r={GAUGE_RADIUS}
          />
          <circle
            className="gauge-arc gauge-arc-progress"
            cx="50"
            cy="50"
            r={GAUGE_RADIUS}
            style={{
              strokeDasharray: GAUGE_CIRCUMFERENCE,
              strokeDashoffset
            }}
          />
        </svg>
      )}

      {showIndicator && indicatorAngle !== null && (
        <div
          className="zone-progress-indicator"
          style={{ '--indicator-angle': `${indicatorAngle}deg` }}
          aria-hidden="true"
        />
      )}

      <div className="avatar-core">
        {avatarSrc ? (
          <img
            src={avatarSrc}
            alt={name || ''}
            onError={handleImageError}
          />
        ) : null}

        {Number.isFinite(heartRate) && (
          <div className="hr-value-overlay" aria-hidden="true">
            <span className="hr-value">{Math.round(heartRate)}</span>
          </div>
        )}

        {children}
      </div>
    </div>
  );
};

CircularUserAvatar.propTypes = {
  name: PropTypes.string,
  avatarSrc: PropTypes.string,
  fallbackSrc: PropTypes.string,
  heartRate: PropTypes.number,
  zoneId: PropTypes.string,
  zoneColor: PropTypes.string,
  progress: PropTypes.number,
  size: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  ringWidth: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  className: PropTypes.string,
  style: PropTypes.object,
  showGauge: PropTypes.bool,
  showIndicator: PropTypes.bool,
  opacity: PropTypes.number,
  ariaLabel: PropTypes.string,
  children: PropTypes.node,
  onClick: PropTypes.func,
  role: PropTypes.string
};

export default CircularUserAvatar;
