/**
 * RpmDeviceAvatar - Unified gauge avatar for RPM devices (bikes + jumprope)
 *
 * Top arc: Progress gauge based on RPM relative to thresholds
 * Bottom arc: Animation varies by device subtype
 *   - cycle: Spinning dashed stroke
 *   - jumprope: Pulses on revolution count change
 */

import React, { useMemo, useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { DaylightMediaPath } from '../../../../lib/api.mjs';
import { calculateRpmProgress, getRpmZoneColor } from './rpmUtils.mjs';
import './RpmDeviceAvatar.scss';

const GAUGE_RADIUS = 47;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;
const HALF_CIRCUMFERENCE = GAUGE_CIRCUMFERENCE / 2;

const RpmDeviceAvatar = ({
  equipmentId,
  equipmentName = 'Equipment',
  rpm = 0,
  revolutionCount = 0,
  rpmThresholds = {},
  deviceSubtype = 'cycle', // 'cycle' | 'jumprope'
  size,
  className = ''
}) => {
  const prevRevCountRef = useRef(revolutionCount);
  const [isPulsing, setIsPulsing] = useState(false);

  // Pulse bottom arc when revolution count changes (jumprope mode)
  useEffect(() => {
    if (
      deviceSubtype === 'jumprope' &&
      revolutionCount !== prevRevCountRef.current &&
      revolutionCount > 0
    ) {
      setIsPulsing(true);
      const timer = setTimeout(() => setIsPulsing(false), 200);
      prevRevCountRef.current = revolutionCount;
      return () => clearTimeout(timer);
    }
    prevRevCountRef.current = revolutionCount;
    return undefined;
  }, [revolutionCount, deviceSubtype]);

  const progress = useMemo(() => calculateRpmProgress(rpm, rpmThresholds), [rpm, rpmThresholds]);
  const zoneColor = useMemo(() => getRpmZoneColor(rpm, rpmThresholds), [rpm, rpmThresholds]);

  // Top arc progress
  const topArcOffset = HALF_CIRCUMFERENCE * (1 - progress);

  // Bottom arc spin duration (for cycle mode)
  const spinDuration = rpm > 0 ? `${270 / Math.max(rpm, 1)}s` : '0s';

  const isActive = rpm > 0;

  const rootStyle = {
    '--rpm-avatar-size': typeof size === 'number' ? `${size}px` : size,
    '--rpm-zone-color': zoneColor,
    '--rpm-spin-duration': spinDuration
  };

  const combinedClassName = [
    'rpm-device-avatar',
    `subtype-${deviceSubtype}`,
    isActive ? 'is-active' : 'is-idle',
    isPulsing ? 'is-pulsing' : '',
    className
  ]
    .filter(Boolean)
    .join(' ');

  const handleImageError = (e) => {
    if (e.target.dataset.fallback) {
      e.target.style.display = 'none';
      return;
    }
    e.target.dataset.fallback = '1';
    e.target.src = DaylightMediaPath('/static/img/equipment/equipment');
  };

  return (
    <div className={combinedClassName} style={rootStyle}>
      <svg
        className="rpm-gauge"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {/* Top arc - track */}
        <path
          className="gauge-arc gauge-arc-track top-arc"
          d="M 3 50 A 47 47 0 0 1 97 50"
          fill="none"
        />

        {/* Top arc - progress */}
        <path
          className="gauge-arc gauge-arc-progress top-arc"
          d="M 3 50 A 47 47 0 0 1 97 50"
          fill="none"
          style={{
            strokeDasharray: HALF_CIRCUMFERENCE,
            strokeDashoffset: topArcOffset,
            stroke: zoneColor
          }}
        />

        {/* Bottom arc - cycle: spinning dashes, jumprope: solid pulse */}
        <path
          className={`gauge-arc bottom-arc ${deviceSubtype === 'cycle' ? 'spinning' : 'pulsing'}`}
          d="M 97 50 A 47 47 0 0 1 3 50"
          fill="none"
          style={{ stroke: zoneColor }}
        />
      </svg>

      <div className="avatar-core">
        <img
          src={DaylightMediaPath(`/static/img/equipment/${equipmentId}`)}
          alt={equipmentName}
          onError={handleImageError}
        />
      </div>
    </div>
  );
};

RpmDeviceAvatar.propTypes = {
  equipmentId: PropTypes.string,
  equipmentName: PropTypes.string,
  rpm: PropTypes.number,
  revolutionCount: PropTypes.number,
  rpmThresholds: PropTypes.shape({
    min: PropTypes.number,
    med: PropTypes.number,
    high: PropTypes.number,
    max: PropTypes.number
  }),
  deviceSubtype: PropTypes.oneOf(['cycle', 'jumprope']),
  size: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  className: PropTypes.string
};

export default RpmDeviceAvatar;
