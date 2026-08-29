import { useState, useEffect, useRef } from 'react';

const TICK_MS = 250;

export function useCountdown({ seconds, running, onExpire }) {
  const [remaining, setRemaining] = useState(seconds);
  const expiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    setRemaining(seconds);
    expiredRef.current = false;
  }, [seconds]);

  useEffect(() => {
    if (!running) return undefined;
    const startedAt = Date.now();
    const startFrom = remaining;
    const id = setInterval(() => {
      const left = Math.max(0, startFrom - (Date.now() - startedAt) / 1000);
      setRemaining(left);
      if (left === 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpireRef.current?.();
        clearInterval(id);
      }
    }, TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only on running/seconds change
  }, [running, seconds]);

  return { remaining, progress: seconds > 0 ? remaining / seconds : 0 };
}
