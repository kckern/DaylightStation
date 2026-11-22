// frontend/src/modules/Media/household/useMoveHere.js
// "Now on <screen> · Move here" (FIND.10a/AC3): bring what another screen is
// playing to this device. It is the same two-owner transaction as a hand-off,
// in the other direction (movePlayback.js): this device adopts the screen's
// session snapshot and must show native playing evidence of that item before
// the screen is stopped — and the screen is stopped only if it is still on
// the same playback (owner + revision) it was when the move began. Anything
// short of that leaves the screen playing and says so.
import { useCallback, useContext } from 'react';
import { LocalSessionContext } from "../session/LocalSessionContext.js";
import { FleetContext } from "../fleet/FleetProvider.jsx";
import { PeekContext } from "../peek/PeekContext.js";
import { DispatchContext } from "../cast/DispatchProvider.jsx";
import { createMoveRequest, executeMove } from "../cast/movePlayback.js";
import { createLocalMoveDestination } from '../cast/localMoveDestination.js';
import mediaLog from "../logging/mediaLog.js";
import { bareScreenId } from "./householdModel.js";
import { deviceName } from "../fleet/deviceDisplay.js";

function ownerIdentity(snapshot) {
  const owner = snapshot?.meta?.playbackOwner;
  if (!owner || typeof owner.ownerInstanceId !== 'string' || !Number.isInteger(owner.playbackRevision)) return null;
  return { sourceOwnerId: owner.ownerInstanceId, sourceRevision: owner.playbackRevision };
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
    const fleetEntry = fleet?.store?.getEntry?.(deviceId) ?? null;
    const snapshot = fleetEntry?.snapshot ?? null;
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
    if (fleetEntry?.offline) return fail('That screen is offline.', 'SOURCE_OFFLINE');
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
      destination: createLocalMoveDestination({ localController: local, forcePlayback: true }),
      source: {
        getIdentity: () => ownerIdentity(fleet?.store?.getEntry?.(deviceId)?.snapshot),
        stopIfCurrent: () => peek?.getController?.(deviceId)?.transport?.stop?.(),
      },
    });

    if (outcome.status !== 'adopted') {
      return fail(outcome.status === 'rejected' ? 'This device could not take it.' : "This device didn't confirm playback. The other screen keeps playing.", outcome.reason);
    }
    if (outcome.sourceStopped !== true) {
      return fail('It plays here now. Could not confirm the other screen stopped.', outcome.reason ?? 'source-not-stopped');
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
