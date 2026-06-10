// frontend/src/modules/Media/peek/useTakeOver.js
// Pull a remote session to this browser (C7.1): the claim endpoint
// atomically stops the device and returns its snapshot (§4.6); the local
// session adopts it. A drift check logs when the adopted position diverges
// beyond the C7.3 tolerance.
import { useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { useSessionController } from '../controller/useSessionController.js';
import { TIMING } from '../constants.js';
import mediaLog from '../logging/mediaLog.js';

function uuid() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* ignore */ }
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useTakeOver() {
  const local = useSessionController('local');
  const { controller } = local;

  return useCallback(async (deviceId) => {
    const commandId = uuid();
    mediaLog.takeoverInitiated({ deviceId, sessionId: null });
    try {
      const res = await DaylightAPI(`api/v1/device/${deviceId}/session/claim`, { commandId }, 'POST');
      if (res?.ok && res.snapshot) {
        const expectedPosition = (res.snapshot.position ?? 0) + TIMING.TAKEOVER_DRIFT_CHECK_DELAY_MS / 1000;
        local.portability?.receiveClaim?.(res.snapshot);
        mediaLog.takeoverSucceeded({ deviceId, sessionId: res.snapshot?.sessionId, position: res.snapshot?.position });
        if (controller) {
          setTimeout(() => {
            const actual = controller.position?.get()?.seconds ?? controller.getSnapshot()?.position ?? 0;
            const driftSeconds = Math.abs(actual - expectedPosition);
            if (driftSeconds > TIMING.TAKEOVER_DRIFT_TOLERANCE_S) {
              mediaLog.takeoverDrift({
                deviceId,
                expected: expectedPosition,
                actual,
                driftSeconds,
                toleranceSeconds: TIMING.TAKEOVER_DRIFT_TOLERANCE_S,
              });
            }
          }, TIMING.TAKEOVER_DRIFT_CHECK_DELAY_MS);
        }
        return { ok: true };
      }
      mediaLog.takeoverFailed({ deviceId, error: res?.error ?? 'unknown' });
      return { ok: false, error: res?.error ?? 'claim-failed' };
    } catch (err) {
      mediaLog.takeoverFailed({ deviceId, error: err?.message });
      return { ok: false, error: err?.message };
    }
  }, [local, controller]);
}

export default useTakeOver;
