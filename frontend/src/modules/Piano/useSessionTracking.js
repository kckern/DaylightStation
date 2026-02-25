import { useState, useEffect, useRef } from 'react';

/**
 * Tracks piano session duration and note count.
 *
 * @param {Array} noteHistory
 * @returns {{ sessionDuration: number }}
 */
export function useSessionTracking(noteHistory) {
  const [sessionDuration, setSessionDuration] = useState(0);
  const sessionStartRef = useRef(null);

  // Track session start
  useEffect(() => {
    if (noteHistory.length > 0 && !sessionStartRef.current) {
      sessionStartRef.current = Date.now();
    }
  }, [noteHistory.length]);

  // Update duration every second
  useEffect(() => {
    const timer = setInterval(() => {
      if (sessionStartRef.current) {
        setSessionDuration((Date.now() - sessionStartRef.current) / 1000);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return { sessionDuration };
}
