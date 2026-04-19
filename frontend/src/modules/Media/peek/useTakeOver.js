import { useCallback, useContext } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { useSessionController } from '../session/useSessionController.js';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import mediaLog from '../logging/mediaLog.js';

const DRIFT_CHECK_DELAY_MS = 1500;
const DRIFT_TOLERANCE_SECONDS = 2;

function uuid() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* ignore */ }
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useTakeOver() {
  const local = useSessionController('local');
  const ctx = useContext(LocalSessionContext);
  const adapter = ctx?.adapter;
  return useCallback(async (deviceId) => {
    const commandId = uuid();
    mediaLog.takeoverInitiated({ deviceId, sessionId: null });
    try {
      const res = await DaylightAPI(`api/v1/device/${deviceId}/session/claim`, { commandId }, 'POST');
      if (res?.ok && res.snapshot) {
        const expectedPosition = (res.snapshot.position ?? 0) + DRIFT_CHECK_DELAY_MS / 1000;
        local.portability?.receiveClaim?.(res.snapshot);
        mediaLog.takeoverSucceeded({ deviceId, sessionId: res.snapshot?.sessionId, position: res.snapshot?.position });
        if (adapter) {
          setTimeout(() => {
            const actual = adapter.getSnapshot()?.position ?? 0;
            const driftSeconds = Math.abs(actual - expectedPosition);
            if (driftSeconds > DRIFT_TOLERANCE_SECONDS) {
              mediaLog.takeoverDrift({
                deviceId,
                expected: expectedPosition,
                actual,
                driftSeconds,
                toleranceSeconds: DRIFT_TOLERANCE_SECONDS,
              });
            }
          }, DRIFT_CHECK_DELAY_MS);
        }
        return { ok: true };
      }
      mediaLog.takeoverFailed({ deviceId, error: res?.error ?? 'unknown' });
      return { ok: false, error: res?.error ?? 'claim-failed' };
    } catch (err) {
      mediaLog.takeoverFailed({ deviceId, error: err?.message });
      return { ok: false, error: err?.message };
    }
  }, [local, adapter]);
}

export default useTakeOver;
