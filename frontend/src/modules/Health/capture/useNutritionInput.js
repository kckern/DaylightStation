import { useCallback, useRef, useState } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { operationRequest } from './operationRequest.js';

const logger = createAppLogger('health').child('capture');

/**
 * Shared submit path for every capture surface (barcode, photo, voice) —
 * one hook so busy/error state and logging aren't duplicated per input type.
 */
export function useNutritionInput() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const requests = useRef(new Map());
  const activeCount = useRef(0);

  const submit = useCallback(async (type, content, { bucket, date, audioRef } = {}) => {
    activeCount.current++; setBusy(true); setError(null);
    // `bucket` and `date` are only added to the body when a caller actually
    // names one — omitting the key entirely (not sending `undefined`) keeps
    // the request byte-identical for every caller that doesn't, and ABSENT
    // still means "today" / "the clock's meal" on the server.
    // `audioRef` is a RETRY over a recording already in the user's store —
    // sent instead of `content`, so nothing has to be recorded again.
    const body = {
      type, content,
      ...(bucket ? { bucket } : {}),
      ...(date ? { date } : {}),
      ...(audioRef ? { audioRef } : {}),
    };
    const fingerprint = JSON.stringify(body);
    // Separate concurrent captures; retain only uncertain requests for retry.
    // A confirmed result releases its ID so logging the same food again is
    // a new intent, not a permanently deduplicated barcode.
    const requestRef = requests.current.get(fingerprint) || { current: null };
    requests.current.set(fingerprint, requestRef);
    logger.info('capture.submit', {
      type, size: String(content || '').length,
      bucket: bucket || undefined, date: date || undefined, audioRef: audioRef || undefined,
    });
    try {
      const result = await DaylightAPI('api/v1/health/nutrition/input', operationRequest(requestRef, body), 'POST');
      if (requests.current.get(fingerprint) === requestRef) requests.current.delete(fingerprint);
      logger.info('capture.result', { type, unknownUpc: result?.unknownUpc === true, moved: result?.moved === true });
      return result;
    } catch (err) {
      logger.error('capture.failed', { type, error: err?.message });
      setError(err);
      throw err;
    } finally { activeCount.current--; setBusy(activeCount.current > 0); }
  }, []);

  return { submit, busy, error };
}
export default useNutritionInput;
