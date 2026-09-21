// frontend/src/modules/Media/peek/useTakeOver.js
// Pull is deliberately unavailable in M0. The legacy claim endpoint stops
// the device before local adoption and lacks owner-qualified proof.
import { useCallback } from 'react';
import mediaLog from '../logging/mediaLog.js';

export function useTakeOver() {
  return useCallback(async (deviceId) => {
    mediaLog.takeoverFailed({ deviceId, error: 'move-unsupported' });
    return { ok: false, error: 'move-unsupported' };
  }, []);
}

export default useTakeOver;
