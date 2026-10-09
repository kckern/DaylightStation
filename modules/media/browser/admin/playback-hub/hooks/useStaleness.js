import { useEffect, useState } from 'react';

/**
 * Derive a staleness signal from a "last updated" timestamp.
 *
 * The broadcaster ticks every 3s. With a default `staleAfterMs` of 10s we
 * tolerate two missed ticks before raising the staleness flag.
 *
 * @param {Date|null} fetchedAt - timestamp of the most recent snapshot
 * @param {{ staleAfterMs?: number, tickMs?: number }} [opts]
 * @returns {{ isStale: boolean, secondsSinceUpdate: number | null }}
 */
export function useStaleness(fetchedAt, opts = {}) {
  const { staleAfterMs = 10000, tickMs = 1000 } = opts;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);

  if (!fetchedAt) {
    return { isStale: true, secondsSinceUpdate: null };
  }

  const elapsed = Math.max(0, now - fetchedAt.getTime());
  return {
    isStale: elapsed > staleAfterMs,
    secondsSinceUpdate: Math.floor(elapsed / 1000),
  };
}

export default useStaleness;
