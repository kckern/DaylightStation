import React, { useState, useEffect, useImperativeHandle, forwardRef, useRef } from 'react';
import PropTypes from 'prop-types';
import { AppIconButton } from '../AppIconButton';
import './Timer.scss';

const Timer = forwardRef(({
  initialSeconds = 0,
  direction = 'down',
  autoStart = false,
  onTick,
  onComplete,
  format = 'mm:ss',
  size = 'lg',
  showControls = false,
  warningThreshold = 10,
  children,
  className,
  ...props
}, ref) => {
  const [seconds, setSeconds] = useState(initialSeconds);
  const [isRunning, setIsRunning] = useState(autoStart);
  const intervalRef = useRef(null);

  useImperativeHandle(ref, () => ({
    start: () => setIsRunning(true),
    pause: () => setIsRunning(false),
    reset: () => {
      setIsRunning(false);
      setSeconds(initialSeconds);
    },
    getTime: () => seconds
  }));

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        setSeconds(prev => {
          const next = direction === 'down' ? prev - 1 : prev + 1;
          
          if (direction === 'down' && next <= 0) {
            setIsRunning(false);
            onComplete?.();
            return 0;
          }
          
          onTick?.(next);
          return next;
        });
      }, 1000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [isRunning, direction, onTick, onComplete]);

  const formatTime = (totalSeconds) => {
    if (format === 'seconds') return totalSeconds;
    
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;

    if (format === 'h:mm:ss') {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const isWarning = direction === 'down' && seconds <= warningThreshold && seconds > 0;

  const combinedClassName = [
    'app-timer',
    `app-timer--${size}`,
    isWarning ? 'app-timer--warning' : '',
    className
  ].filter(Boolean).join(' ');

  if (children) {
    return children({ seconds, isRunning, formatTime });
  }

  return (
    <div className={combinedClassName} {...props}>
      <div className="app-timer__display">
        {formatTime(seconds)}
      </div>
      
      {showControls && (
        <div className="app-timer__controls">
          <AppIconButton
            icon={isRunning ? <span>⏸</span> : <span>▶</span>}
            onClick={() => setIsRunning(!isRunning)}
            variant="ghost"
            size="sm"
            ariaLabel={isRunning ? 'Pause' : 'Start'}
          />
          <AppIconButton
            icon={<span>↺</span>}
            onClick={() => {
              setIsRunning(false);
              setSeconds(initialSeconds);
            }}
            variant="ghost"
            size="sm"
            ariaLabel="Reset"
          />
        </div>
      )}
    </div>
  );
});

Timer.propTypes = {
  initialSeconds: PropTypes.number,
  direction: PropTypes.oneOf(['up', 'down']),
  autoStart: PropTypes.bool,
  onTick: PropTypes.func,
  onComplete: PropTypes.func,
  format: PropTypes.oneOf(['mm:ss', 'h:mm:ss', 'seconds']),
  size: PropTypes.oneOf(['sm', 'md', 'lg', 'xl']),
  showControls: PropTypes.bool,
  warningThreshold: PropTypes.number,
  children: PropTypes.func,
  className: PropTypes.string
};

export default Timer;
