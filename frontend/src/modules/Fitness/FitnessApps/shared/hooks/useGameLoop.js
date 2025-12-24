import { useRef, useEffect, useState, useCallback } from 'react';

const useGameLoop = ({
  onFrame,
  targetFps = 60,
  autoStart = true
}) => {
  const requestRef = useRef(null);
  const previousTimeRef = useRef(null);
  const frameCountRef = useRef(0);
  const [isRunning, setIsRunning] = useState(autoStart);
  const [fps, setFps] = useState(0);
  const lastFpsUpdateRef = useRef(0);
  const framesSinceLastFpsUpdateRef = useRef(0);

  const animate = useCallback((time) => {
    if (previousTimeRef.current !== undefined) {
      const deltaTime = time - previousTimeRef.current;
      
      // Calculate FPS
      framesSinceLastFpsUpdateRef.current++;
      if (time - lastFpsUpdateRef.current >= 1000) {
        setFps(Math.round((framesSinceLastFpsUpdateRef.current * 1000) / (time - lastFpsUpdateRef.current)));
        lastFpsUpdateRef.current = time;
        framesSinceLastFpsUpdateRef.current = 0;
      }

      // Cap max delta time to prevent huge jumps
      const cappedDelta = Math.min(deltaTime, 100);
      
      onFrame?.(cappedDelta, frameCountRef.current);
      frameCountRef.current++;
    }
    previousTimeRef.current = time;
    requestRef.current = requestAnimationFrame(animate);
  }, [onFrame]);

  useEffect(() => {
    if (isRunning) {
      requestRef.current = requestAnimationFrame(animate);
    } else {
      cancelAnimationFrame(requestRef.current);
      previousTimeRef.current = undefined;
    }
    return () => cancelAnimationFrame(requestRef.current);
  }, [isRunning, animate]);

  return {
    start: () => setIsRunning(true),
    stop: () => setIsRunning(false),
    isRunning,
    frameCount: frameCountRef.current,
    fps
  };
};

export default useGameLoop;
