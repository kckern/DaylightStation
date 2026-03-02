import React, { useRef, useEffect, useMemo } from 'react';
import PropTypes from 'prop-types';
import getLogger from '../../../../lib/logging/Logger.js';
import './VibrationActivityAvatar.scss';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'VibrationActivityAvatar' });
  return _logger;
}

const DEFAULT_RING_COLORS = {
  none: 'var(--color-muted, #666)',
  low: 'var(--color-success, #4caf50)',
  medium: 'var(--color-warning, #ff9800)',
  high: 'var(--color-danger, #f44336)',
  active: 'var(--color-info, #2196f3)'
};

const formatDuration = (ms) => {
  if (!ms || ms <= 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
};

const VibrationActivityAvatar = ({
  snapshot = {},
  avatarSrc,
  avatarAlt = '',
  fallbackSrc = '',
  showIntensityRing = false,
  showActivityBar = false,
  showTimer = true,
  ringColorMap = DEFAULT_RING_COLORS,
  size = 80,
  className = '',
  style
}) => {
  const ringRef = useRef(null);
  const prevIntensityRef = useRef('none');
  const didFallbackRef = useRef(false);

  const {
    status = 'idle',
    sessionDurationMs = 0,
    intensityLevel = 'none',
    currentIntensity = 0,
    recentIntensityHistory = [],
    estimatedImpacts = 0,
    peakIntensity = 0
  } = snapshot;

  const isActive = status === 'active';
  const ringColor = showIntensityRing
    ? (ringColorMap[intensityLevel] || ringColorMap.none)
    : (isActive ? (ringColorMap.active || DEFAULT_RING_COLORS.active) : ringColorMap.none);

  // Reset fallback guard when image source changes
  useEffect(() => {
    didFallbackRef.current = false;
  }, [avatarSrc, fallbackSrc]);

  // Pulse animation via Web Animations API (CSS transitions killed by TVApp)
  useEffect(() => {
    if (!ringRef.current) return;
    const prev = prevIntensityRef.current;
    prevIntensityRef.current = intensityLevel;

    if (intensityLevel !== prev && intensityLevel !== 'none') {
      logger().debug('intensity-pulse', { from: prev, to: intensityLevel });
      ringRef.current.animate([
        { transform: 'scale(1.15)', opacity: 1 },
        { transform: 'scale(1)', opacity: 0.8 }
      ], { duration: 300, easing: 'ease-out' });
    }
  }, [intensityLevel]);

  // Activity bar: normalize heights to session peak
  const barData = useMemo(() => {
    if (!showActivityBar || recentIntensityHistory.length === 0) return [];
    const max = Math.max(peakIntensity, ...recentIntensityHistory, 1);
    return recentIntensityHistory.map(v => ({
      height: Math.max(2, Math.round((v / max) * 100)),
      value: v
    }));
  }, [showActivityBar, recentIntensityHistory, peakIntensity]);

  const handleImageError = (e) => {
    if (!fallbackSrc || didFallbackRef.current) {
      e.currentTarget.style.display = 'none';
      return;
    }
    didFallbackRef.current = true;
    e.currentTarget.src = fallbackSrc;
  };

  const rootClass = ['vibration-activity-avatar', isActive ? 'is-active' : 'is-idle', className]
    .filter(Boolean).join(' ');

  return (
    <div className={rootClass} style={{ '--vib-size': `${size}px`, ...style }}>
      <div className="vib-avatar-ring" ref={ringRef} style={{ borderColor: ringColor }}>
        <div className="vib-avatar-content">
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt={avatarAlt}
              className="vib-avatar-image"
              onError={handleImageError}
            />
          ) : (
            <div className="vib-avatar-placeholder" />
          )}
        </div>
      </div>

      {showTimer && (
        <div className="vib-timer">
          {isActive ? formatDuration(sessionDurationMs) : '--:--'}
        </div>
      )}

      {showActivityBar && barData.length > 0 && (
        <div className="vib-activity-bar">
          {barData.map((bar, i) => (
            <div
              key={i}
              className="vib-bar-segment"
              style={{
                height: `${bar.height}%`,
                backgroundColor: ringColor
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

VibrationActivityAvatar.propTypes = {
  snapshot: PropTypes.shape({
    status: PropTypes.string,
    sessionDurationMs: PropTypes.number,
    intensityLevel: PropTypes.string,
    currentIntensity: PropTypes.number,
    recentIntensityHistory: PropTypes.arrayOf(PropTypes.number),
    estimatedImpacts: PropTypes.number,
    peakIntensity: PropTypes.number
  }),
  avatarSrc: PropTypes.string,
  avatarAlt: PropTypes.string,
  fallbackSrc: PropTypes.string,
  showIntensityRing: PropTypes.bool,
  showActivityBar: PropTypes.bool,
  showTimer: PropTypes.bool,
  ringColorMap: PropTypes.object,
  size: PropTypes.number,
  className: PropTypes.string,
  style: PropTypes.object
};

export default VibrationActivityAvatar;
