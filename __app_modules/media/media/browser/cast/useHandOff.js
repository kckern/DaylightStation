// frontend/src/modules/Media/cast/useHandOff.js
// Push the local session to a device (C7.2): full snapshot (hot-tier
// position included) dispatched in adopt mode. A transfer uses the typed
// receiver executor and stops local only after native adoption evidence;
// a fork remains a non-destructive ordinary dispatch (C7.4).
//
// `startAt` (seconds) sets where the destination starts instead of the
// captured live position — the fling's "Start from the beginning" passes 0.
// It rides the snapshot's `position`, which both destinations already honour
// (typed hand-off: positionPolicy.absolute; idle screen: the adopt load), and
// marks the started item `resume: false` so the screen's Player never trades
// that start for the library's saved spot (SinglePlayer passes `resume` to
// /play). `play: true` (the fling) sends the snapshot as playing, so a paused
// item here starts playing there; a plain move keeps a paused item paused.
import { useCallback, useContext } from 'react';
import { LocalSessionContext } from "../session/LocalSessionContext.js";
import { useDispatch } from "./useDispatch.js";
import { createMoveRequest, executeMove } from "./movePlayback.js";
import { createScreenMoveDestination } from "./screenMove.js";
import { FleetContext } from "../fleet/FleetProvider.jsx";
import mediaLog from "../logging/mediaLog.js";

export function useHandOff() {
  const local = useContext(LocalSessionContext)?.controller ?? null;
  const fleetStore = useContext(FleetContext)?.store ?? null;
  const { dispatchToTarget } = useDispatch();
  return useCallback(async (deviceId, { mode = 'transfer', startAt = null, play = false } = {}) => {
    if (mode === 'transfer') {
      const captured = local?.portability?.capture?.();
      if (!captured?.snapshot || !captured?.identity) return { ok: false, error: 'no-snapshot' };
      // capture() returns a detached copy: editing it never touches this session.
      const sent = captured.snapshot;
      if (Number.isFinite(startAt)) {
        sent.position = Math.max(0, startAt);
        const index = sent.queue?.currentIndex ?? -1;
        const entry = index >= 0 ? sent.queue?.items?.[index] : null;
        if (entry) entry.resume = false;
        if (sent.currentItem) sent.currentItem.resume = false;
      }
      if (play === true) sent.state = 'playing';
      const operationId = globalThis.crypto?.randomUUID?.()
        ?? `move-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      let request;
      try {
        request = createMoveRequest({ operationId, destinationId: deviceId, snapshot: captured.snapshot, keepSource: false });
      } catch {
        return { ok: false, error: 'invalid-source' };
      }
      mediaLog.handoffInitiated({ deviceId, mode, operationId, ...(Number.isFinite(startAt) ? { startAt: Math.round(startAt) } : {}), ...(play === true ? { play: true } : {}) });
      const source = {
        getIdentity: () => {
          const identity = local?.portability?.capture?.()?.identity;
          return identity ? {
            sourceOwnerId: identity.ownerInstanceId,
            sourceRevision: identity.playbackRevision,
          } : null;
        },
        stopIfCurrent: () => local?.portability?.stopIfCurrent?.(captured.identity),
      };
      const outcome = await executeMove(request, {
        source,
        // The typed hand-off where the screen has an owner to capture; the
        // ordinary adopt load for an idle screen (shared with the Remote's
        // Move to…, screenMove.js).
        destination: createScreenMoveDestination({ deviceId, fleetStore }),
      });
      if (outcome.status !== 'adopted' || outcome.sourceStopped !== true) {
        mediaLog.handoffFailed?.({ deviceId, mode, operationId, error: outcome.reason });
        return { ok: false, ...outcome, error: outcome.reason ?? outcome.status };
      }
      return { ok: true, ...outcome };
    }
    const snapshot = local?.portability?.snapshotForHandoff?.();
    if (!snapshot) return { ok: false, error: 'no-snapshot' };
    mediaLog.handoffInitiated({ deviceId, mode });
    const dispatchIds = await dispatchToTarget({ targetIds: [deviceId], snapshot, mode });
    return { ok: true, dispatchIds };
  }, [local, dispatchToTarget, fleetStore]);
}

export default useHandOff;
