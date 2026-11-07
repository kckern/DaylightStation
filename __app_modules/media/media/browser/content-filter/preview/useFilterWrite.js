/**
 * useFilterWrite — busy/error state and the one write path the preview rail's
 * panels share: run the request, refresh the player's filter on success, show the
 * error text (and leave the player alone) on failure.
 */
import { useState, useCallback } from 'react';
import { previewStore } from './previewStore.js';

export const errText = (e) => e?.message || 'request failed';

export function useFilterWrite(logger) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const write = useCallback(async (fn, event, data) => {
    setBusy(true); setError('');
    try {
      const out = await fn();
      await previewStore.refresh();
      if (event) logger.info(event, data);
      return out;
    } catch (e) {
      setError(errText(e));
      logger.warn('content-filter.workshop.failed', { ...data, error: errText(e) });
      return undefined;
    } finally { setBusy(false); }
  }, [logger]);
  return { error, setError, busy, setBusy, write };
}
