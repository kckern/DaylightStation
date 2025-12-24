import React, { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import './CountdownRing.scss';

/**
 * CountdownRing - Circular countdown timer with progress ring
 * 
 * Extracted from VoiceMemoOverlay.jsx auto-accept feature.
 */
const CountdownRing = ({
  duration = 5000,
  autoStart = true,
  paused = false,
  onComplete,
  onTick,
  size = 'md',
  strokeWidth = 4,
  color = 'primary',
  showTime = true,
  showProgress = true,
  direction = 'clockwise',
  children,
  className,
  ...props
}) => {
  const [progress, setProgress] = useState(0);
  const [remaining, setRemaining] = useState(duration);
  const [isRunning, setIsRunning] = useState(autoStart);
  const startTimeRef = useRef(null);
  const rafRef = useRef(null);

  const updateProgress = useCallback(() => {
    if (!startTimeRef.current || paused) return;

    const elapsed = Date.now() - startTimeRef.current;
    const newProgress = Math.min(1, elapsed / duration);
    const newRemaining = Math.max(0, duration - elapsed);

    setProgress(newProgress);
    setRemaining(newRemaining);
    onTick?.(newRemaining, newProgress);

    if (newProgress >= 1) {
      setIsRunning(false);
      onComplete?.();
      return;
    }

    rafRef.current = requestAnimationFrame(updateProgress);
  }, [duration, paused, onTick, onComplete]);

  useEffect(() => {
    if (isRunning && !paused) {
      if (!startTimeRef.current) {
        startTimeRef.current = Date.now();
      }
      rafRef.current = requestAnimationFrame(updateProgress);
    } else {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [isRunning, paused, updateProgress]);

  // Reset when duration changes
  useEffect(() => {
    setProgress(0);
    setRemaining(duration);
    startTimeRef.current = null;
    if (autoStart) {
      setIsRunning(true);
    }
  }, [duration, autoStart]);

  const start = useCallback(() => {
    startTimeRef.current = Date.now();
    setIsRunning(true);
  }, []);

  const stop = useCallback(() => {
    setIsRunning(false);
    startTimeRef.current = null;
  }, []);

  const reset = useCallback(() => {
    setProgress(0);
    setRemaining(duration);
    startTimeRef.current = null;
    setIsRunning(false);
  }, [duration]);

  // SVG calculations
  const sizeMap = { sm: 48, md: 64, lg: 96, xl: 128 };
  const svgSize = typeof size === 'number' ? size : sizeMap[size] || 64;
  const radius = (svgSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = direction === 'clockwise'
    ? circumference * (1 - progress)
    : circumference * progress;

  const combinedClassName = [
    'countdown-ring',
    `countdown-ring--${color}`,
    isRunning ? 'countdown-ring--running' : '',
    paused ? 'countdown-ring--paused' : '',
    className
  ].filter(Boolean).join(' ');

  const remainingSeconds = Math.ceil(remaining / 1000);

  return (
    <div 
      className={combinedClassName} 
      style={{ width: svgSize, height: svgSize }}
      {...props}
    >
      {showProgress && (
        <svg className="countdown-ring__svg" viewBox={`0 0 ${svgSize} ${svgSize}`}>
          {/* Background circle */}
          <circle
            className="countdown-ring__track"
            cx={svgSize / 2}
            cy={svgSize / 2}
            r={radius}
            strokeWidth={strokeWidth}
            fill="none"
          />
          {/* Progress circle */}
          <circle
            className="countdown-ring__progress"
            cx={svgSize / 2}
            cy={svgSize / 2}
            r={radius}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            transform={`rotate(-90 ${svgSize / 2} ${svgSize / 2})`}
          />
        </svg>
      )}
      
      <div className="countdown-ring__content">
        {children || (showTime && (
          <span className="countdown-ring__time">{remainingSeconds}</span>
        ))}
      </div>
    </div>
  );
};

CountdownRing.propTypes = {
  /** Total duration in milliseconds */
  duration: PropTypes.number,
  /** Auto-start countdown */
  autoStart: PropTypes.bool,
  /** Pause the countdown */
  paused: PropTypes.bool,
  /** Callback when countdown completes */
  onComplete: PropTypes.func,
  /** Callback each tick with (remaining, progress) */
  onTick: PropTypes.func,
  /** Ring size: 'sm' | 'md' | 'lg' | 'xl' or number */
  size: PropTypes.oneOfType([
    PropTypes.oneOf(['sm', 'md', 'lg', 'xl']),
    PropTypes.number
  ]),
  /** Stroke width in pixels */
  strokeWidth: PropTypes.number,
  /** Color variant */
  color: PropTypes.oneOf(['primary', 'success', 'warning', 'danger', 'gray']),
  /** Show remaining seconds */
  showTime: PropTypes.bool,
  /** Show progress ring */
  showProgress: PropTypes.bool,
  /** Progress direction */
  direction: PropTypes.oneOf(['clockwise', 'counterclockwise']),
  /** Custom content inside ring */
  children: PropTypes.node,
  /** Additional CSS class */
  className: PropTypes.string
};

export default CountdownRing;
