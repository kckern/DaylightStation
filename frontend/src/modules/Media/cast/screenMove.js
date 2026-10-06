// frontend/src/modules/Media/cast/screenMove.js
// Move playback from one OTHER screen to another screen or to this device
// (PLACE.9a, RQ-PLACE-13), failure-safe like every move here
// (movePlayback.js): the destination must positively adopt first; only then
// is the source stopped — through its claim, which stops it with
// `intent: "move"` so the people there see "Moved by <this device>" — and
// only if it is still playing the same thing. If the destination does not
// confirm, the source keeps playing and nothing is stopped.
//
// The snapshot is the source's last published state (§9.2) with its spot
// carried forward by the time since it was heard, so the destination picks
// up at the same moment.
import { DaylightAPI } from '../../../lib/api.mjs';
import { createMoveRequest, executeMove } from './movePlayback.js';
import { createRemoteMoveDestination } from './remoteMoveDestination.js';
import { reportedSpot } from './reportedSpot.js';
import mediaLog from '../logging/mediaLog.js';

const ACTIVE = new Set(['playing', 'paused', 'buffering']);

function ownerIdentity(snapshot) {
  const owner = snapshot?.meta?.playbackOwner;
  if (!owner || typeof owner.ownerInstanceId !== 'string' || !Number.isInteger(owner.playbackRevision)) return null;
  return { sourceOwnerId: owner.ownerInstanceId, sourceRevision: owner.playbackRevision };
}

function uuid() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* ignore */ }
  return `move-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const ADOPT_OBSERVE_MS = 45_000;

/**
 * A screen that is idle has no playback owner to capture, so the typed
 * hand-off cannot start there. It adopts through the ordinary adopt load
 * instead (§4.7), and counts as adopted only once the screen itself reports
 * the same item (fresh state) — positive evidence, never the HTTP result
 * alone.
 */
export function createLoadAdoptDestination({ deviceId, fleetStore, http = DaylightAPI, observeMs = ADOPT_OBSERVE_MS }) {
  return {
    async adopt(request) {
      const contentId = request.snapshot?.currentItem?.contentId;
      const before = fleetStore?.getEntry?.(deviceId)?.snapshot ?? null;
      const adopted = (entry) => {
        const snap = entry?.snapshot;
        return !!snap && !entry.offline && !entry.isStale
          && snap.currentItem?.contentId === contentId
          && ['playing', 'paused', 'buffering'].includes(snap.state)
          && (before?.sessionId == null || snap.sessionId !== before.sessionId
            || before.currentItem?.contentId !== contentId);
      };
      let response;
      try {
        response = await http(`api/v1/device/${deviceId}/load`, {
          dispatchId: `${request.operationId}:adopt`, snapshot: request.snapshot, mode: 'adopt',
        }, 'POST');
      } catch (error) {
        return { status: 'uncertain', reason: error?.message ?? 'adopt-not-confirmed' };
      }
      if (response?.ok === false) return { status: 'rejected', reason: response.error ?? 'adopt-refused' };
      if (adopted(fleetStore?.getEntry?.(deviceId))) return { status: 'adopted' };
      return new Promise((resolve) => {
        let done = false;
        const finish = (result) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          unsubscribe?.();
          resolve(result);
        };
        const unsubscribe = fleetStore?.subscribeDevice?.(deviceId, (entry) => {
          if (adopted(entry)) finish({ status: 'adopted' });
        });
        const timer = setTimeout(() => finish({ status: 'uncertain', reason: 'adopt-not-observed' }), observeMs);
      });
    },
  };
}

/** A screen: the typed hand-off when it has an owner to capture, else the adopt load. */
export function createScreenMoveDestination({ deviceId, fleetStore, http = DaylightAPI }) {
  const handoff = createRemoteMoveDestination({ deviceId, http });
  const viaLoad = createLoadAdoptDestination({ deviceId, fleetStore, http });
  return {
    async adopt(request) {
      const result = await handoff.adopt(request);
      // An explicit refusal (an idle screen answers INVALID_CAPTURE: there is
      // no owner to hand over to) or a capture that never confirmed started
      // nothing, so the adopt load is safe. An uncertain START is not: it may
      // have started, and is reported as such.
      if (result.status === 'rejected'
        || (result.status === 'uncertain' && result.reason === 'capture-not-confirmed')) {
        mediaLog.screenMoveInitiated({ destinationId: deviceId, operationId: request.operationId, path: 'adopt-load' });
        return viaLoad.adopt(request);
      }
      return result;
    },
  };
}

/** This device as a move destination: adopt the snapshot in the local session. */
export function createLocalMoveDestination({ localController }) {
  return {
    async adopt(request) {
      if (!localController?.portability?.adopt) return { status: 'rejected', reason: 'no-local-session' };
      const result = localController.portability.adopt(request.snapshot, {
        autoplay: request.snapshot.state !== 'paused',
      });
      return result?.ok === false
        ? { status: 'rejected', reason: result.code ?? 'local-adopt-failed' }
        : { status: 'adopted' };
    },
  };
}

/**
 * @param {object} opts
 * @param {string} opts.sourceId         the screen playing now
 * @param {string} opts.destinationId    another screen's id, or 'local'
 * @param {object} opts.fleetStore
 * @param {object} [opts.localController]
 * @param {object} [opts.origin]         this device, for the source's note
 * @returns {Promise<{ ok: boolean, status?, reason?, sourceStopped? , title? }>}
 */
export async function moveScreenPlayback({
  sourceId, destinationId, fleetStore, localController = null, origin = null,
  http = DaylightAPI, operationId = uuid(), now = () => Date.now(),
  destination: destinationOverride = null,
}) {
  const entry = fleetStore?.getEntry?.(sourceId);
  const published = entry?.snapshot;
  if (!entry || entry.offline || entry.isStale || !published?.currentItem || !ACTIVE.has(published.state)) {
    return { ok: false, reason: 'source-not-playing' };
  }
  if (destinationId === sourceId) return { ok: false, reason: 'same-screen' };
  const snapshot = JSON.parse(JSON.stringify(published));
  const spot = reportedSpot(published, entry.receivedAt, now());
  if (Number.isFinite(spot)) snapshot.position = spot;
  const title = published.currentItem.title ?? null;
  let request;
  try {
    request = createMoveRequest({ operationId, destinationId, snapshot, keepSource: false });
  } catch {
    mediaLog.screenMoveFailed({ sourceId, destinationId, operationId, reason: 'no-owner-identity' });
    return { ok: false, reason: 'no-owner-identity', title };
  }
  mediaLog.screenMoveInitiated({ sourceId, destinationId, operationId, contentId: published.currentItem.contentId, position: Math.round(snapshot.position ?? 0) });

  const destination = destinationOverride ?? (destinationId === 'local'
    ? createLocalMoveDestination({ localController })
    : createScreenMoveDestination({ deviceId: destinationId, fleetStore, http }));
  const source = {
    getIdentity: () => ownerIdentity(fleetStore.getEntry(sourceId)?.snapshot),
    stopIfCurrent: async () => {
      try {
        const claimed = await http(`api/v1/device/${sourceId}/session/claim`, {
          commandId: `${operationId}:claim`, ...(origin ? { origin } : {}),
        }, 'POST');
        return claimed?.ok === false ? { ok: false, code: claimed.code ?? 'claim-refused' } : { ok: true };
      } catch (error) {
        return { ok: false, code: error?.message ?? 'claim-failed' };
      }
    },
  };
  const outcome = await executeMove(request, { source, destination });
  if (outcome.status === 'adopted' && outcome.sourceStopped === true) {
    mediaLog.screenMoveSucceeded({ sourceId, destinationId, operationId });
    return { ok: true, ...outcome, title };
  }
  mediaLog.screenMoveFailed({ sourceId, destinationId, operationId, status: outcome.status, reason: outcome.reason ?? null, sourceStopped: outcome.sourceStopped ?? false });
  return { ok: false, ...outcome, reason: outcome.reason ?? outcome.status, title };
}

/** Plain words for why a move did not finish. */
export function moveFailureReason(result) {
  switch (result?.reason) {
    case 'source-not-playing': return 'Nothing is playing there to move';
    case 'no-owner-identity': return "That screen can't hand over its playback yet";
    case 'source-changed': return 'Something else started there first; both screens kept playing';
    case 'same-screen': return 'It is already playing there';
    default:
      if (result?.status === 'adopted') return 'It started at the new screen, but the old one did not stop';
      return 'The new screen did not confirm; the original kept playing';
  }
}

export default moveScreenPlayback;
