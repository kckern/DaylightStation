import { useState, useEffect, useRef, useCallback } from 'react';

const useCountdown = ({
  initialSeconds = 60,
  onTick,
  onComplete,
  autoStart = false
}) => {
  const [time, setTime] = useState(initialSeconds);
  const [isRunning, setIsRunning] = useState(autoStart);
  const intervalRef = useRef(null);
  const onTickRef = useRef(onTick);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onTickRef.current = onTick;
    onCompleteRef.current = onComplete;
  }, [onTick, onComplete]);

  const start = useCallback(() => setIsRunning(true), []);
  const pause = useCallback(() => setIsRunning(false), []);
  
  const reset = useCallback((newSeconds) => {
    setIsRunning(false);
    setTime(typeof newSeconds === 'number' ? newSeconds : initialSeconds);
  }, [initialSeconds]);

  useEffect(() => {
    if (isRunning && time > 0) {
      intervalRef.current = setInterval(() => {
        setTime((prev) => {
          const next = prev - 1;
          if (next <= 0) {
            setIsRunning(false);
            onCompleteRef.current?.();
            return 0;
          }
          onTickRef.current?.(next);
          return next;
        });
      }, 1000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [isRunning, time]);

  return {
    time,
    isRunning,
    start,
    pause,
    reset,
    isComplete: time === 0
  };
};

export default useCountdown;
