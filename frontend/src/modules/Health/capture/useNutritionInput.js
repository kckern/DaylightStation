import { useCallback, useState } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('capture');

/**
 * Shared submit path for every capture surface (barcode, photo, voice) —
 * one hook so busy/error state and logging aren't duplicated per input type.
 */
export function useNutritionInput() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = useCallback(async (type, content) => {
    setBusy(true); setError(null);
    logger.info('capture.submit', { type, size: String(content || '').length });
    try {
      const result = await DaylightAPI('api/v1/health/nutrition/input', { type, content }, 'POST');
      logger.info('capture.result', { type, unknownUpc: result?.unknownUpc === true });
      return result;
    } catch (err) {
      logger.error('capture.failed', { type, error: err?.message });
      setError(err);
      throw err;
    } finally { setBusy(false); }
  }, []);

  return { submit, busy, error };
}
export default useNutritionInput;
