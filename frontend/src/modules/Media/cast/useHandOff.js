// frontend/src/modules/Media/cast/useHandOff.js
// Push the local session to a device (C7.2): full snapshot (hot-tier
// position included) dispatched in adopt mode. Transfer-vs-fork is handled
// by the dispatch provider — local stops only on confirmed success (C7.4).
import { useCallback } from 'react';
import { useSessionController } from '../controller/useSessionController.js';
import { useDispatch } from './DispatchProvider.jsx';
import mediaLog from '../logging/mediaLog.js';

export function useHandOff() {
  const local = useSessionController('local');
  const { dispatchToTarget } = useDispatch();
  return useCallback(async (deviceId, { mode = 'transfer' } = {}) => {
    const snapshot = local.portability?.snapshotForHandoff?.();
    if (!snapshot) return { ok: false, error: 'no-snapshot' };
    mediaLog.handoffInitiated({ deviceId, mode });
    const dispatchIds = await dispatchToTarget({ targetIds: [deviceId], snapshot, mode });
    return { ok: true, dispatchIds };
  }, [local, dispatchToTarget]);
}

export default useHandOff;
