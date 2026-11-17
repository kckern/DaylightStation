import React, { useEffect, useLayoutEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import "./CircularUserAvatar.scss";
import GovernanceStartBadge from "./GovernanceStartBadge.jsx";
import getLogger from '@/lib/logging/Logger.js';
import {
  angleForProgress, lapDirection, ringArcs, easeInOut, easeOut, RING_TWEEN_MS, RING_LAP_MS
} from './zoneRingMotion.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'circular-user-avatar' });
  return _logger;
}

const GAUGE_RADIUS = 47;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;

const clamp = (value, min, max) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.min(Math.max(value, min), max);
};

// Paint one arc of the ring: [start, end] degrees clockwise from 3 o'clock.
const paintArc = (el, arc, color) => {
  if (!el) return;
  const length = arc ? ((arc[1] - arc[0]) / 360) * GAUGE_CIRCUMFERENCE : 0;
  if (!(length > 0.01)) {
    el.style.visibility = 'hidden';
    return;
  }
  el.style.visibility = 'visible';
  el.style.strokeDasharray = `${length} ${GAUGE_CIRCUMFERENCE}`;
  el.style.strokeDashoffset = `${(-arc[0] / 360) * GAUGE_CIRCUMFERENCE}`;
  if (color !== undefined) el.style.stroke = color || '';
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
  role,
  boostBadge,
  statusBadge = null,
  weakSignal = false
}) => {
  const isFireZone = zoneId === 'fire';
  //if fire, showIndicator is false
  if (isFireZone) {
    showIndicator = false;
  }
  const hasActiveHr = Number.isFinite(heartRate) && heartRate > 0;
  const normalizedProgress = clamp(progress, 0, 1);
  const targetAngle = normalizedProgress !== null ? angleForProgress(normalizedProgress) : null;

  // The ring is animated here, frame by frame, straight onto the SVG: a zone
  // crossing laps the ring (zoneRingMotion.js), which two CSS transitions on
  // independent properties cannot draw.
  const currentArcRef = useRef(null);
  const previousArcRef = useRef(null);
  const orbitRef = useRef(null);
  const motion = useRef({
    angle: null, zoneId: null, color: null, prevColor: null, lap: 0,
    from: 0, to: 0, startedAt: 0, duration: 0, frame: 0
  });

  const paint = () => {
    const m = motion.current;
    if (m.angle === null) {
      paintArc(currentArcRef.current, null);
      paintArc(previousArcRef.current, null);
      return;
    }
    const { current, previous } = ringArcs(m.angle, m.lap);
    paintArc(currentArcRef.current, current);
    paintArc(previousArcRef.current, previous, m.prevColor);
    orbitRef.current?.style.setProperty('--indicator-angle', `${m.angle}deg`);
  };

  const land = () => {
    const m = motion.current;
    if (m.frame) cancelAnimationFrame(m.frame);
    m.frame = 0;
    m.angle = m.to - 360 * m.lap;
    m.lap = 0;
  };

  const tween = (to, duration, ease = easeInOut) => {
    const m = motion.current;
    if (m.frame) cancelAnimationFrame(m.frame);
    m.from = m.angle;
    m.to = to;
    m.duration = duration;
    m.startedAt = 0;
    const step = (ts) => {
      if (!m.startedAt) m.startedAt = ts;
      const t = Math.min(1, (ts - m.startedAt) / m.duration);
      m.angle = m.from + (m.to - m.from) * ease(t);
      if (t >= 1) land();
      else m.frame = requestAnimationFrame(step);
      paint();
    };
    m.frame = requestAnimationFrame(step);
  };

  const zoneKey = zoneId ? String(zoneId).toLowerCase() : null;
  useLayoutEffect(() => {
    const m = motion.current;
    if (targetAngle === null || m.angle === null) {
      if (m.frame) cancelAnimationFrame(m.frame);
      Object.assign(m, { angle: targetAngle, zoneId: zoneKey, color: zoneColor, lap: 0, frame: 0 });
      paint();
      return;
    }
    if (zoneKey !== m.zoneId) {
      if (m.lap) land();
      const dir = lapDirection(m.zoneId, zoneKey);
      if (dir) logger().debug('zone-ring.lap', { name, from: m.zoneId, to: zoneKey, direction: dir > 0 ? 'up' : 'down' });
      Object.assign(m, { prevColor: m.color, zoneId: zoneKey, color: zoneColor, lap: dir });
      tween(targetAngle + 360 * dir, dir ? RING_LAP_MS : RING_TWEEN_MS, dir ? easeOut : easeInOut);
      return;
    }
    m.color = zoneColor;
    const to = targetAngle + 360 * m.lap;
    if (m.frame ? to !== m.to : to !== m.angle) tween(to, RING_TWEEN_MS);
  }, [targetAngle, zoneKey, zoneColor]); // eslint-disable-line react-hooks/exhaustive-deps

  // Repaint after every render: the gauge remounts when HR returns.
  useLayoutEffect(paint);
  useEffect(() => () => {
    if (motion.current.frame) cancelAnimationFrame(motion.current.frame);
  }, []);

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
    !hasActiveHr ? 'no-hr' : null,
    weakSignal ? 'weak-signal' : null,
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
      {boostBadge ? (
        <div className="vital-boost-badge" aria-hidden="true">{boostBadge}</div>
      ) : null}
      <GovernanceStartBadge statusBadge={statusBadge} className="vital-start-badge" />
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

      {showGauge && hasActiveHr && (
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
            ref={previousArcRef}
            className="gauge-arc gauge-arc-progress gauge-arc-previous"
            cx="50"
            cy="50"
            r={GAUGE_RADIUS}
          />
          <circle
            ref={currentArcRef}
            className="gauge-arc gauge-arc-progress"
            cx="50"
            cy="50"
            r={GAUGE_RADIUS}
          />
        </svg>
      )}

      {showIndicator && targetAngle !== null && (
        <div ref={orbitRef} className="zone-progress-orbit" aria-hidden="true">
          <div className="zone-progress-indicator" />
        </div>
      )}

      <div className="avatar-core">
        {avatarSrc ? (
          <img
            src={avatarSrc}
            alt={name || ''}
            onError={handleImageError}
          />
        ) : null}

        {Number.isFinite(heartRate) && heartRate > 0 && (
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
  role: PropTypes.string,
  boostBadge: PropTypes.string,
  statusBadge: PropTypes.shape({
    status: PropTypes.string,
    zoneLabel: PropTypes.string,
    remainingMs: PropTypes.number
  }),
  weakSignal: PropTypes.bool
};

export default CircularUserAvatar;
