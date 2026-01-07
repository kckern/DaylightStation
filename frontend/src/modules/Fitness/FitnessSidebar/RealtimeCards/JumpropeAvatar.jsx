/**
 * JumpropeAvatar - Circular avatar with RPM gauge and pulsing bottom arc
 * 
 * Top arc: Progress gauge showing RPM relative to min/max thresholds
 * Bottom arc: Pulses when new data arrives
 */

import React, { useMemo, useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { DaylightMediaPath } from '../../../../lib/api.mjs';
import './JumpropeAvatar.scss';

const GAUGE_RADIUS = 47;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;
const HALF_CIRCUMFERENCE = GAUGE_CIRCUMFERENCE / 2;

// RPM zone colors
const RPM_COLORS = {
  idle: '#666',
  min: '#3b82f6',    // blue
  med: '#22c55e',    // green
  high: '#f59e0b',   // orange
  max: '#ef4444'     // red
};

/**
 * Get RPM zone color based on current RPM and thresholds
 */
function getRpmZoneColor(rpm, thresholds = {}) {
  const { min = 10, med = 50, high = 80, max = 120 } = thresholds;
  if (!Number.isFinite(rpm) || rpm < min) return RPM_COLORS.idle;
  if (rpm >= max) return RPM_COLORS.max;
  if (rpm >= high) return RPM_COLORS.high;
  if (rpm >= med) return RPM_COLORS.med;
  return RPM_COLORS.min;
}

/**
 * Calculate progress (0-1) based on RPM and thresholds
 */
function getRpmProgress(rpm, thresholds = {}) {
  const { min = 10, max = 120 } = thresholds;
  if (!Number.isFinite(rpm) || rpm <= min) return 0;
  if (rpm >= max) return 1;
  return (rpm - min) / (max - min);
}

const JumpropeAvatar = ({
  equipmentId,
  equipmentName = 'Jump Rope',
  rpm = 0,
  jumps = 0,
  rpmThresholds = {},
  size,
  className = ''
}) => {
  const { min = 10, max = 120 } = rpmThresholds;
  
  // Track previous jumps to detect changes
  const prevJumpsRef = useRef(jumps);
  const [isPulsing, setIsPulsing] = useState(false);
  
  // Pulse when jumps value changes
  useEffect(() => {
    if (jumps !== prevJumpsRef.current && jumps > 0) {
      setIsPulsing(true);
      const timer = setTimeout(() => setIsPulsing(false), 200);
      prevJumpsRef.current = jumps;
      return () => clearTimeout(timer);
    }
  }, [jumps]);
  
  // Calculate progress for top gauge arc
  const progress = useMemo(() => getRpmProgress(rpm, rpmThresholds), [rpm, rpmThresholds]);
  
  // Get zone color
  const zoneColor = useMemo(() => getRpmZoneColor(rpm, rpmThresholds), [rpm, rpmThresholds]);
  
  // Calculate stroke dash offset for top arc (half circle, top)
  const topArcOffset = HALF_CIRCUMFERENCE * (1 - progress);
  
  const isActive = rpm > 0;

  const rootStyle = {
    '--jumprope-size': typeof size === 'number' ? `${size}px` : size,
    '--jumprope-zone-color': zoneColor
  };

  const combinedClassName = [
    'jumprope-avatar',
    isActive ? 'is-active' : 'is-idle',
    isPulsing ? 'is-pulsing' : '',
    className
  ].filter(Boolean).join(' ');

  const handleImageError = (e) => {
    if (e.target.dataset.fallback) {
      e.target.style.display = 'none';
      return;
    }
    e.target.dataset.fallback = '1';
    e.target.src = DaylightMediaPath('/media/img/equipment/equipment');
  };

  return (
    <div className={combinedClassName} style={rootStyle}>
      {/* SVG arcs */}
      <svg
        className="jumprope-gauge"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {/* Top arc - track (dim background) */}
        <path
          className="gauge-arc gauge-arc-track top-arc"
          d="M 3 50 A 47 47 0 0 1 97 50"
          fill="none"
        />
        
        {/* Top arc - progress (fills based on RPM) */}
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
        
        {/* Bottom arc - pulses on data update */}
        <path
          className="gauge-arc bottom-arc"
          d="M 97 50 A 47 47 0 0 1 3 50"
          fill="none"
          style={{ stroke: zoneColor }}
        />
      </svg>
      
      {/* Center avatar image */}
      <div className="avatar-core">
        <img
          src={DaylightMediaPath(`/media/img/equipment/${equipmentId}`)}
          alt={equipmentName}
          onError={handleImageError}
        />
      </div>
    </div>
  );
};

JumpropeAvatar.propTypes = {
  equipmentId: PropTypes.string,
  equipmentName: PropTypes.string,
  rpm: PropTypes.number,
  jumps: PropTypes.number,
  rpmThresholds: PropTypes.shape({
    min: PropTypes.number,
    med: PropTypes.number,
    high: PropTypes.number,
    max: PropTypes.number
  }),
  size: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  className: PropTypes.string
};

export default JumpropeAvatar;
