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

  const submit = useCallback(async (type, content, { bucket, date } = {}) => {
    setBusy(true); setError(null);
    // `bucket` and `date` are only added to the body when a caller actually
    // names one — omitting the key entirely (not sending `undefined`) keeps
    // the request byte-identical for every caller that doesn't, and ABSENT
    // still means "today" / "the clock's meal" on the server.
    const body = { type, content, ...(bucket ? { bucket } : {}), ...(date ? { date } : {}) };
    logger.info('capture.submit', { type, size: String(content || '').length, bucket: bucket || undefined, date: date || undefined });
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
