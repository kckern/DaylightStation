import { useCallback, useEffect, useState } from 'react';

/** Show feedback for a full interval after the latest successful action. */
export function useTemporaryIndicator(durationMs) {
  const [version, setVersion] = useState(0);
  const show = useCallback(() => setVersion(current => current + 1), []);

  useEffect(() => {
    if (!version) return;
    const timer = setTimeout(() => {
      setVersion(current => current === version ? 0 : current);
    }, durationMs);
    return () => clearTimeout(timer);
  }, [version, durationMs]);

  return [version !== 0, show];
}
