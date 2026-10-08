// frontend/src/modules/Media/household/useMoveHere.js
// "Now on <screen> · Move here" (FIND.10a/AC3): bring what another screen is
// playing to this device. It is the same two-owner transaction as a hand-off,
// in the other direction (movePlayback.js): this device adopts the screen's
// session snapshot and must show native playing evidence of that item before
// the screen is stopped — and the screen is stopped only if it is still on
// the same playback (owner + revision) it was when the move began. Anything
// short of that leaves the screen playing and says so.
import { useCallback, useContext } from 'react';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { PeekContext } from '../peek/PeekContext.js';
import { DispatchContext } from '../cast/DispatchProvider.jsx';
import { createMoveRequest, executeMove } from '../cast/movePlayback.js';
import mediaLog from '../logging/mediaLog.js';
import { bareScreenId } from './householdModel.js';
import { deviceName } from '../fleet/deviceDisplay.js';

export const MOVE_HERE_EVIDENCE_TIMEOUT_MS = 20_000;

function ownerIdentity(snapshot) {
  const owner = snapshot?.meta?.playbackOwner;
  if (!owner || typeof owner.ownerInstanceId !== 'string' || !Number.isInteger(owner.playbackRevision)) return null;
  return { sourceOwnerId: owner.ownerInstanceId, sourceRevision: owner.playbackRevision };
}

/** Resolves true once this device's native element is playing `contentId`. */
export function waitForLocalPlayback(local, contentId, { timeoutMs = MOVE_HERE_EVIDENCE_TIMEOUT_MS, interval = 250 } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let unsubscribe = () => {};
    const finish = (value) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      clearTimeout(deadline);
      unsubscribe();
      resolve(value);
    };
    const check = () => {
      const obs = local?.portability?.getNativeObservation?.();
      if (obs?.identity && String(obs.identity.contentId) === String(contentId)
        && obs.paused === false && obs.readyState >= 2) finish(true);
    };
    const timer = setInterval(check, interval);
    const deadline = setTimeout(() => finish(false), timeoutMs);
    unsubscribe = local?.portability?.subscribeNative?.(check) ?? (() => {});
    check();
  });
}

function newOperationId() {
  return globalThis.crypto?.randomUUID?.() ?? `move-here-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// One move per screen at a time, across every surface (a FleetCard and a Home
// "Now on" card are separate hook instances): a second tap must not adopt twice.
const inFlightScreens = new Set();

export function useMoveHere() {
  const local = useContext(LocalSessionContext)?.controller ?? null;
  const fleet = useContext(FleetContext);
  const peek = useContext(PeekContext);
  const outcomes = useContext(DispatchContext);

  const move = useCallback(async (screenId, entry = {}) => {
    const deviceId = bareScreenId(screenId);
    const snapshot = fleet?.store?.getEntry?.(deviceId)?.snapshot ?? null;
    const contentId = snapshot?.currentItem?.contentId ?? entry.contentId ?? null;
    const title = snapshot?.currentItem?.title ?? entry.title ?? null;
    const operationId = newOperationId();
    mediaLog.moveHereInitiated({ deviceId, contentId, operationId });
    // PLACE.7a/AC3: the confirmation says which screen it came from.
    const sourceDevice = (fleet?.devices ?? []).find((device) => device?.id === deviceId) ?? null;
    const sourceName = deviceName(sourceDevice ?? { id: deviceId }, deviceId);
    const attemptId = outcomes?.recordLocal?.({ kind: 'moveHere', phase: 'running', item: { contentId, title }, command: { sourceId: deviceId, sourceName } }) ?? null;
    const fail = (reason, code) => {
      mediaLog.moveHereFailed({ deviceId, contentId, operationId, error: code ?? reason });
      outcomes?.resolveLocal?.(attemptId, { phase: 'failed', reason });
      return { ok: false, code: code ?? reason, reason };
    };

    if (!local?.lifecycle?.adoptSnapshot) return fail('This device cannot play here right now.', 'NO_LOCAL_SESSION');
    if (!snapshot?.currentItem || (contentId && entry.contentId && contentId !== entry.contentId)) {
      return fail('That screen is no longer playing it.', 'SOURCE_CHANGED');
    }
    let request;
    try {
      request = createMoveRequest({ operationId, destinationId: 'local', snapshot, keepSource: false });
    } catch {
      return fail("That screen can't hand over its playback.", 'NO_SOURCE_IDENTITY');
    }

    const outcome = await executeMove(request, {
      destination: {
        adopt: async (req) => {
          const adopted = local.lifecycle.adoptSnapshot(req.snapshot, { autoplay: true });
          if (adopted?.ok === false) return { status: 'rejected', reason: adopted.code ?? 'adopt-rejected' };
          const playing = await waitForLocalPlayback(local, contentId);
          return playing ? { status: 'adopted' } : { status: 'uncertain', reason: 'not-playing-here' };
        },
      },
      source: {
        getIdentity: () => ownerIdentity(fleet?.store?.getEntry?.(deviceId)?.snapshot),
        stopIfCurrent: async () => {
          const result = await peek?.getController?.(deviceId)?.transport?.stop?.();
          return result ?? { ok: true };
        },
      },
    });

    if (outcome.status !== 'adopted') {
      return fail(outcome.status === 'rejected' ? 'This device could not take it.' : "It didn't start here; the other screen keeps playing.", outcome.reason);
    }
    if (outcome.sourceStopped !== true) {
      return fail('It plays here now, but the other screen is still playing.', outcome.reason ?? 'source-not-stopped');
    }
    mediaLog.moveHereSucceeded({ deviceId, contentId, operationId });
    outcomes?.resolveLocal?.(attemptId, { phase: 'confirmed' });
    return { ok: true };
  }, [local, fleet, peek, outcomes]);

  return useCallback(async (screenId, entry = {}) => {
    const key = bareScreenId(screenId);
    if (inFlightScreens.has(key)) {
      mediaLog.moveHereIgnored({ deviceId: key, reason: 'in-flight' });
      return { ok: false, code: 'IN_FLIGHT' };
    }
    inFlightScreens.add(key);
    try { return await move(screenId, entry); } finally { inFlightScreens.delete(key); }
  }, [move]);
}

export default useMoveHere;
