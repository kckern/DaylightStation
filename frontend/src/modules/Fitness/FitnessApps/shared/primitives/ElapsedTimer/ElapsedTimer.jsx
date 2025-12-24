import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { formatTime, getElapsedSeconds } from '../../utils/time';
import './ElapsedTimer.scss';

/**
 * ElapsedTimer - Live elapsed time display from a start timestamp
 * 
 * Extracted from FitnessTreasureBox.jsx for reuse.
 */
const ElapsedTimer = ({
  startTime,
  format = 'auto',
  paused = false,
  updateInterval = 1000,
  onTick,
  size = 'md',
  variant = 'default',
  prefix,
  suffix,
  className,
  ...props
}) => {
  const [elapsed, setElapsed] = useState(() => getElapsedSeconds(startTime));
  const intervalRef = useRef(null);

  useEffect(() => {
    if (paused || !startTime) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Initial update
    const newElapsed = getElapsedSeconds(startTime);
    setElapsed(newElapsed);
    onTick?.(newElapsed);

    // Start interval
    intervalRef.current = setInterval(() => {
      const currentElapsed = getElapsedSeconds(startTime);
      setElapsed(currentElapsed);
      onTick?.(currentElapsed);
    }, updateInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [startTime, paused, updateInterval, onTick]);

  const formattedTime = formatTime(elapsed, { format });

  const combinedClassName = [
    'elapsed-timer',
    `elapsed-timer--${size}`,
    `elapsed-timer--${variant}`,
    paused ? 'elapsed-timer--paused' : '',
    className
  ].filter(Boolean).join(' ');

  return (
    <span className={combinedClassName} {...props}>
      {prefix && <span className="elapsed-timer__prefix">{prefix}</span>}
      <span className="elapsed-timer__time">{formattedTime}</span>
      {suffix && <span className="elapsed-timer__suffix">{suffix}</span>}
    </span>
  );
};

ElapsedTimer.propTypes = {
  /** Start timestamp (epoch ms, Date, or ISO string) */
  startTime: PropTypes.oneOfType([
    PropTypes.number,
    PropTypes.instanceOf(Date),
    PropTypes.string
  ]),
  /** Time format: 'mm:ss' | 'hh:mm:ss' | 'auto' */
  format: PropTypes.oneOf(['mm:ss', 'hh:mm:ss', 'auto']),
  /** Pause timer updates */
  paused: PropTypes.bool,
  /** Update interval in milliseconds */
  updateInterval: PropTypes.number,
  /** Callback fired each tick with elapsed seconds */
  onTick: PropTypes.func,
  /** Display size */
  size: PropTypes.oneOf(['sm', 'md', 'lg', 'xl']),
  /** Visual variant */
  variant: PropTypes.oneOf(['default', 'mono', 'badge']),
  /** Text before time */
  prefix: PropTypes.node,
  /** Text after time */
  suffix: PropTypes.node,
  /** Additional CSS class */
  className: PropTypes.string
};

export default ElapsedTimer;
