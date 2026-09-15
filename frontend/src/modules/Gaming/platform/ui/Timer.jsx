import React, { useState, useEffect, useImperativeHandle, forwardRef, useRef } from 'react';
import './Timer.scss';

// Both a controlled wall-clock deadline and the legacy imperative Fitness timer.
const Timer = forwardRef(function Timer({ initialSeconds = 0, deadline = null, durationMs,
  direction = 'down', autoStart = false, onTick, onComplete, format = 'mm:ss', size = 'lg',
  showControls = false, warningThreshold = 10, children, className = '', ...props }, ref) {
  const controlled = Number.isFinite(deadline);
  const read = () => controlled ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : initialSeconds;
  const [seconds, setSeconds] = useState(read);
  const [running, setRunning] = useState(autoStart);
  const callbacks = useRef({ onTick, onComplete }); callbacks.current = { onTick, onComplete };
  const finished = useRef(null);
  const value = useRef(seconds); value.current = seconds;
  const reset = () => { setRunning(false); setSeconds(initialSeconds); finished.current = null; };
  useImperativeHandle(ref, () => ({ start: () => setRunning(true), pause: () => setRunning(false), reset, getTime: () => value.current }));
  useEffect(() => {
    if (!controlled && !running) return;
    const started = Date.now(); const initial = value.current;
    const tick = () => {
      const next = controlled ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
        : Math.max(0, initial + (direction === 'up' ? 1 : -1) * Math.floor((Date.now() - started) / 1000));
      setSeconds(next);
      if (next !== value.current && (controlled || direction !== 'down' || next > 0)) callbacks.current.onTick?.(next);
      value.current = next;
      const key = controlled ? deadline : started;
      if (next <= 0 && direction === 'down' && finished.current !== key) {
        finished.current = key; setRunning(false); callbacks.current.onComplete?.();
      }
    };
    tick(); const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [controlled, deadline, running, direction]);
  const formatTime = (time) => {
    if (format === 'seconds') return time;
    const hours = Math.floor(time / 3600); const minutes = Math.floor(time % 3600 / 60); const secs = String(time % 60).padStart(2, '0');
    return format === 'h:mm:ss' ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${String(minutes).padStart(2, '0')}:${secs}`;
  };
  const isRunning = controlled ? seconds > 0 : running;
  if (children) return children({ seconds, isRunning, formatTime, progress: durationMs ? Math.min(1, seconds * 1000 / durationMs) : 0 });
  return <div className={`app-timer app-timer--${size}${direction === 'down' && seconds > 0 && seconds <= warningThreshold ? ' app-timer--warning' : ''} ${className}`} {...props}>
    <div className="app-timer__display">{formatTime(seconds)}</div>
    {showControls && !controlled && <div className="app-timer__controls"><button type="button" aria-label={running ? 'Pause' : 'Start'} onClick={() => setRunning(!running)}>{running ? '⏸' : '▶'}</button><button type="button" aria-label="Reset" onClick={reset}>↺</button></div>}
  </div>;
});
export default Timer;
