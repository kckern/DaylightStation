import { useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { useSessionController } from '../session/useSessionController.js';
import mediaLog from '../logging/mediaLog.js';

function uuid() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* ignore */ }
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useTakeOver() {
  const local = useSessionController('local');
  return useCallback(async (deviceId) => {
    const commandId = uuid();
    mediaLog.takeoverInitiated({ deviceId, sessionId: null });
    try {
      const res = await DaylightAPI(`api/v1/device/${deviceId}/session/claim`, { commandId }, 'POST');
      if (res?.ok && res.snapshot) {
        local.portability?.receiveClaim?.(res.snapshot);
        mediaLog.takeoverSucceeded({ deviceId, sessionId: res.snapshot?.sessionId, position: res.snapshot?.position });
        return { ok: true };
      }
      mediaLog.takeoverFailed({ deviceId, error: res?.error ?? 'unknown' });
      return { ok: false, error: res?.error ?? 'claim-failed' };
    } catch (err) {
      mediaLog.takeoverFailed({ deviceId, error: err?.message });
      return { ok: false, error: err?.message };
    }
  }, [local]);
}

export default useTakeOver;
