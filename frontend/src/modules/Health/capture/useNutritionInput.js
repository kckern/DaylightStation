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

  const submit = useCallback(async (type, content, { bucket } = {}) => {
    setBusy(true); setError(null);
    // `bucket` is only added to the body when a caller actually names one —
    // omitting the key entirely (not sending `bucket: undefined`) keeps the
    // request byte-identical to the pre-Task-4.2 shape for every existing
    // caller that doesn't pass one.
    const body = bucket ? { type, content, bucket } : { type, content };
    logger.info('capture.submit', { type, size: String(content || '').length, bucket: bucket || undefined });
    try {
      const result = await DaylightAPI('api/v1/health/nutrition/input', body, 'POST');
      logger.info('capture.result', { type, unknownUpc: result?.unknownUpc === true, moved: result?.moved === true });
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
