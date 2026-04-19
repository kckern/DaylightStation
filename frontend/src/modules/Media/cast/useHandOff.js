import { useCallback } from 'react';
import { useSessionController } from '../session/useSessionController.js';
import { useDispatch } from './useDispatch.js';
import mediaLog from '../logging/mediaLog.js';

export function useHandOff() {
  const local = useSessionController('local');
  const { dispatchToTarget } = useDispatch();
  return useCallback(async (deviceId, { mode = 'transfer' } = {}) => {
    const snapshot = local.portability?.snapshotForHandoff?.();
    if (!snapshot) return { ok: false, error: 'no-snapshot' };
    mediaLog.handoffInitiated({ deviceId, mode });
    const dispatchIds = await dispatchToTarget({ targetIds: [deviceId], snapshot, mode: 'adopt' });
    if (mode === 'transfer') {
      try { local.transport?.stop?.(); } catch { /* ignore */ }
    }
    return { ok: true, dispatchIds };
  }, [local, dispatchToTarget]);
}

export default useHandOff;
