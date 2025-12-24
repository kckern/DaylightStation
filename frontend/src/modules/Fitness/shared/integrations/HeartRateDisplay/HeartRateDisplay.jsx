import React from 'react';
import PropTypes from 'prop-types';
import { Gauge } from '../../primitives';
import './HeartRateDisplay.scss';

const HeartRateDisplay = ({
  bpm = 0,
  zone,
  maxHr = 190,
  showGraph = false,
  history = [],
  size = 'md',
  className,
  ...props
}) => {
  const zones = [
    { min: 0, max: maxHr * 0.5, color: 'var(--zone-gray)' },
    { min: maxHr * 0.5, max: maxHr * 0.6, color: 'var(--zone-blue)' },
    { min: maxHr * 0.6, max: maxHr * 0.7, color: 'var(--zone-green)' },
    { min: maxHr * 0.7, max: maxHr * 0.8, color: 'var(--zone-yellow)' },
    { min: maxHr * 0.8, max: maxHr * 0.9, color: 'var(--zone-orange)' },
    { min: maxHr * 0.9, max: maxHr * 1.1, color: 'var(--zone-red)' },
  ];

  return (
    <div className={`heart-rate-display ${className || ''}`} {...props}>
      <Gauge
        value={bpm}
        min={40}
        max={maxHr}
        zones={zones}
        label="Heart Rate"
        units="BPM"
        size={size}
      />
      {zone && (
        <div className="heart-rate-display__zone">
          Zone {zone}
        </div>
      )}
    </div>
  );
};

HeartRateDisplay.propTypes = {
  bpm: PropTypes.number,
  zone: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  maxHr: PropTypes.number,
  showGraph: PropTypes.bool,
  history: PropTypes.array,
  size: PropTypes.oneOf(['sm', 'md', 'lg', 'xl']),
  className: PropTypes.string
};

export default HeartRateDisplay;
