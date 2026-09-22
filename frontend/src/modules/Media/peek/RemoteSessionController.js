// frontend/src/modules/Media/peek/RemoteSessionController.js
// The remote half of the controller symmetry seam: same interface as the
// local controller, but commands go over HTTP to the device session API
// (§4.3–4.5) and state comes from the fleet store's device-state feed —
// the device's broadcast is ground truth; this controller holds no session
// state of its own. Returned promises resolve on device ack.
import { DaylightAPI } from '../../../lib/api.mjs';
import { createPositionChannel } from '../session/positionChannel.js';
import { addResultFromSnapshot } from '../session/queueOps.js';
import mediaLog from '../logging/mediaLog.js';

function uuid() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* ignore */ }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const PLAYING = 'playing';
// A remote state change is published after the receiver's 500ms change
// debounce, then regular state publication is covered by its 5s heartbeat.
// Start the bounded observation at the positive device ack: command dispatch
// itself can precede the permitted 5s ack interval, so it is not evidence that
// the receiver has accepted the Play (media-app-technical §§4.3, 6.4).
const PLAY_PUBLICATION_WINDOW_MS = 5_500;
const QUEUE_PUBLICATION_WINDOW_MS = 5_500;

export function createRemoteSessionController({
  deviceId,
  fleetStore,
  ackRouter,
  http = DaylightAPI,
  randomUuid = uuid,
  tickerIntervalMs = 1000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  onSteeringActivity = null,
}) {
  const base = `api/v1/device/${deviceId}/session`;
  const position = createPositionChannel();

  const snapshot = () => fleetStore.getEntry(deviceId)?.snapshot ?? null;

  // Hot position tier for remote sessions: seeded from each broadcast,
  // extrapolated at 1Hz while playing — but only while someone is actually
  // watching (a seek bar is subscribed).
  let posSubscribers = 0;
  let ticker = null;
  let pendingSteering = null;
  let steeringGeneration = 0;
  const syncFromSnapshot = (snap) => {
    if (snap && typeof snap.position === 'number') position.set(snap.position);
  };
  const startTicker = () => {
    if (ticker) return;
    ticker = setIntervalFn(() => {
      const snap = snapshot();
      if (snap?.state === PLAYING) position.set(position.get().seconds + tickerIntervalMs / 1000);
    }, tickerIntervalMs);
  };
  const stopTicker = () => {
    if (ticker) { clearIntervalFn(ticker); ticker = null; }
  };

  const samePlayback = (left, right) => left?.sessionId === right?.sessionId
    && left?.contentId === right?.contentId
    && (left?.queueItemId == null || left.queueItemId === right?.queueItemId);

  const freshPlayback = (entry, { playingOnly = false } = {}) => {
    const current = entry?.snapshot?.currentItem;
    const sessionId = entry?.snapshot?.sessionId;
    if (entry?.isStale || entry?.offline || (playingOnly && entry?.snapshot?.state !== PLAYING)
      || typeof sessionId !== 'string' || !sessionId
      || typeof current?.contentId !== 'string' || !current.contentId) return null;
    return {
      sessionId,
      contentId: current.contentId,
      ...(typeof current.queueItemId === 'string' && current.queueItemId
        ? { queueItemId: current.queueItemId }
        : {}),
    };
  };

  const reportSteering = (playback) => onSteeringActivity?.({ deviceId, playback });

  const isCurrentSteeringAttempt = (attempt) => pendingSteering === attempt;

  const clearPendingSteering = (attempt = pendingSteering) => {
    if (!attempt || !isCurrentSteeringAttempt(attempt)) return;
    if (attempt.timer) clearTimeout(attempt.timer);
    pendingSteering = null;
  };

  const finishPendingSteering = (attempt) => {
    if (!isCurrentSteeringAttempt(attempt)
      || !attempt.acknowledged || !attempt.httpAccepted || !attempt.observedPlaying) return;
    const playback = attempt.observedPlaying;
    clearPendingSteering(attempt);
    reportSteering(playback);
  };

  const reconcilePendingSteering = (entry) => {
    const attempt = pendingSteering;
    if (!attempt) return;
    if (entry?.offline || entry?.isStale) {
      clearPendingSteering(attempt);
      return;
    }
    const identity = freshPlayback(entry);
    // A fresh different identity is evidence that another command or person
    // took over; it invalidates this attempt even while HTTP or its ack is
    // still in flight, so a delayed continuation cannot revive the old Play.
    if (identity && !samePlayback(attempt.expectedPlayback, identity)) {
      clearPendingSteering(attempt);
      return;
    }
    const playing = freshPlayback(entry, { playingOnly: true });
    if (playing && samePlayback(attempt.expectedPlayback, playing)) {
      attempt.observedPlaying = playing;
      finishPendingSteering(attempt);
    }
  };

  const beginPlayAttempt = () => {
    clearPendingSteering();
    const generation = ++steeringGeneration;
    const expectedPlayback = freshPlayback(fleetStore.getEntry(deviceId));
    if (!expectedPlayback) return null;
    const attempt = {
      generation,
      expectedPlayback,
      acknowledged: false,
      httpAccepted: false,
      observedPlaying: null,
      timer: null,
    };
    pendingSteering = attempt;
    return attempt;
  };

  const acknowledgePlayAttempt = (attempt) => {
    if (!isCurrentSteeringAttempt(attempt)) return;
    attempt.acknowledged = true;
    attempt.timer = setTimeout(() => {
      // Matching paused heartbeats never renew this one-debounce-plus-one-
      // heartbeat window, so it cannot become an idle-style long lease.
      if (isCurrentSteeringAttempt(attempt) && attempt.generation === steeringGeneration) {
        clearPendingSteering(attempt);
      }
    }, PLAY_PUBLICATION_WINDOW_MS);
    reconcilePendingSteering(fleetStore.getEntry(deviceId));
  };

  const acceptPlayHttp = (attempt) => {
    if (!isCurrentSteeringAttempt(attempt)) return;
    attempt.httpAccepted = true;
    reconcilePendingSteering(fleetStore.getEntry(deviceId));
  };

  const detachFleet = fleetStore.subscribeDevice(deviceId, (entry) => {
    syncFromSnapshot(entry?.snapshot);
    reconcilePendingSteering(entry);
  });
  syncFromSnapshot(snapshot());

  const logCommand = (action, value) => {
    mediaLog.peekCommand({ deviceId, action, ...(value !== undefined ? { value } : {}) });
  };

  // A remote-control panel opening is observation, not steering. Only a
  // command that has made the full HTTP + device-ack round trip earns a
  // steering lease, and even then only against a fresh, currently playing
  // snapshot with a concrete playback identity. `meta.ownerId` names the
  // receiving screen, so it is deliberately not used as source provenance.
  const observedPlayback = () => freshPlayback(fleetStore.getEntry(deviceId), { playingOnly: true });

  const send = (method, path, body, action, { onPositiveAck = null } = {}) => {
    // The next remote command is newer user intent. It supersedes a pending
    // Play before either request leg can settle, even if that newer command
    // later fails; only a current command may earn steering activity.
    if (action !== 'play') clearPendingSteering();
    // Create the Play attempt before either request leg can settle. Every
    // later Play starts a new generation and invalidates this one, including
    // while its HTTP request or device ack remains in flight.
    const playAttempt = action === 'play' ? beginPlayAttempt() : null;
    const commandId = randomUuid();
    const ackPromise = ackRouter.register(commandId, { action, deviceId });
    const httpPromise = http(path, { ...body, commandId }, method);
    if (typeof onPositiveAck === 'function') {
      ackPromise.then(
        () => onPositiveAck(),
        () => {},
      );
    }
    if (playAttempt) {
      ackPromise.then(
        () => acknowledgePlayAttempt(playAttempt),
        () => clearPendingSteering(playAttempt)
      );
      httpPromise.then(
        () => acceptPlayHttp(playAttempt),
        () => clearPendingSteering(playAttempt)
      );
    }
    // HTTP failure rejects immediately; otherwise the ack decides.
    return Promise.all([httpPromise, ackPromise]).then(([httpRes]) => {
      const playback = observedPlayback();
      if (action === 'play') {
        // Both continuation legs verify their generation before recording or
        // reporting. This check also covers an old Promise completion that
        // follows a newer Play.
        if (playAttempt && isCurrentSteeringAttempt(playAttempt)
          && playback && samePlayback(playAttempt.expectedPlayback, playback)) {
          playAttempt.observedPlaying = playback;
          finishPendingSteering(playAttempt);
        }
      } else if (playback) reportSteering(playback);
      return { ok: true, http: httpRes, commandId };
    });
  };

  const transportPost = (action, value) => {
    logCommand(action, value);
    return send('POST', `${base}/transport`, value !== undefined ? { action, value } : { action }, action);
  };

  const observeQueueAdd = (input) => {
    const before = snapshot();
    const beforeLength = before?.queue?.items?.length ?? 0;
    const beforeCurrent = before?.currentItem ?? null;
    const beforeIndex = before?.queue?.currentIndex;
    const beforeSessionId = before?.sessionId;
    const beforeOwner = before?.meta?.playbackOwner;
    const beforeRevision = before?.meta?.playbackOwner?.queueRevision;
    let detach = null;
    let timer = null;
    let settled = false;
    let deadlineStarted = false;
    let finish = () => {};
    let reconcile = () => {};
    const promise = new Promise((resolve, reject) => {
      finish = (result, error = null) => {
        if (settled) return;
        settled = true;
        detach?.();
        if (timer) clearTimeout(timer);
        if (error) reject(error);
        else resolve(result);
      };
      reconcile = (entry = fleetStore.getEntry(deviceId)) => {
        if (entry?.offline || entry?.isStale) {
          finish(null, new Error('queue-state-unavailable'));
          return;
        }
        const next = entry?.snapshot;
        const items = next?.queue?.items;
        const result = addResultFromSnapshot(next);
        const current = next?.currentItem ?? null;
        const playbackPreserved = next?.sessionId === beforeSessionId
          && next?.queue?.currentIndex === beforeIndex
          && (beforeCurrent == null
            ? current == null
            : current?.contentId === beforeCurrent.contentId
              && current?.queueItemId === beforeCurrent.queueItemId)
          && (beforeOwner?.ownerInstanceId == null
            || next?.meta?.playbackOwner?.ownerInstanceId === beforeOwner.ownerInstanceId)
          && (beforeOwner?.playbackRevision == null
            || next?.meta?.playbackOwner?.playbackRevision === beforeOwner.playbackRevision);
        if (!result || !Array.isArray(items) || items.length <= beforeLength
          || !playbackPreserved
          || items.at(-1)?.contentId !== input.contentId
          || (Number.isInteger(beforeRevision) && result.queueRevision <= beforeRevision)) return;
        finish(result);
      };
      detach = fleetStore.subscribeDevice(deviceId, reconcile);
      if (settled) {
        detach?.();
        detach = null;
        return;
      }
      reconcile();
    });
    const startDeadline = () => {
      if (settled || deadlineStarted) return;
      deadlineStarted = true;
      timer = setTimeout(
        () => finish(null, new Error('queue-state-timeout')),
        QUEUE_PUBLICATION_WINDOW_MS,
      );
      reconcile();
    };
    return {
      promise,
      startDeadline,
      cancel: () => finish(null, new Error('queue-observation-cancelled')),
    };
  };

  return {
    kind: 'remote',
    id: deviceId,

    getSnapshot: snapshot,
    subscribe: (fn) => fleetStore.subscribeDevice(deviceId, (entry) => fn(entry?.snapshot ?? null)),

    execute: (command) => send('POST', `${base}/queue/item-action`, {
      kind: command.kind, item: command.item, collectionItems: command.collectionItems,
      operationId: command.operationId, tappedAt: command.tappedAt, clearRest: command.clearRest, queueItemId: command.queueItemId,
    }, 'item-action').then(result => ({ ...result, operationId: command.operationId, expiresAt: command.tappedAt + 10000 })),
    undo: async (operationId) => {
      const cancelled = await http(`${base}/item-action/${encodeURIComponent(operationId)}/cancel`, {}, 'POST');
      if (cancelled?.ok === false || cancelled?.pending) return cancelled;
      return send('POST', `${base}/queue/undo`, { operationId }, 'undo');
    },

    position: {
      get: position.get,
      subscribe: (fn) => {
        posSubscribers += 1;
        startTicker();
        const unsub = position.subscribe(fn);
        return () => {
          unsub();
          posSubscribers -= 1;
          if (posSubscribers <= 0) stopTicker();
        };
      },
    },

    transport: {
      play: () => transportPost('play'),
      pause: () => transportPost('pause'),
      stop: () => transportPost('stop'),
      seekAbs: (seconds) => transportPost('seekAbs', seconds),
      seekRel: (delta) => transportPost('seekRel', delta),
      skipNext: () => transportPost('skipNext'),
      skipPrev: () => transportPost('skipPrev'),
      restartCurrent: () => transportPost('seekAbs', 0),
    },

    queue: {
      playNow: (input, opts = {}) =>
        send('POST', `${base}/queue/play-now`, { contentId: input.contentId, clearRest: !!opts.clearRest }, 'queue.playNow'),
      playNext: (input) => send('POST', `${base}/queue/play-next`, { contentId: input.contentId }, 'queue.playNext'),
      addUpNext: (input) => send('POST', `${base}/queue/add-up-next`, { contentId: input.contentId }, 'queue.addUpNext'),
      add: (input) => {
        const observation = observeQueueAdd(input);
        const request = send(
          'POST',
          `${base}/queue/add`,
          { contentId: input.contentId },
          'queue.add',
          { onPositiveAck: observation.startDeadline },
        );
        return Promise.all([request, observation.promise]).then(([, result]) => result, (error) => {
          observation.cancel();
          throw error;
        });
      },
      reorder: (input) => send('POST', `${base}/queue/reorder`, input, 'queue.reorder'),
      remove: (queueItemId) => send('POST', `${base}/queue/remove`, { queueItemId }, 'queue.remove'),
      jump: (queueItemId) => send('POST', `${base}/queue/jump`, { queueItemId }, 'queue.jump'),
      clear: () => send('POST', `${base}/queue/clear`, {}, 'queue.clear'),
    },

    config: {
      setShuffle: (enabled) => {
        logCommand('setShuffle', !!enabled);
        return send('PUT', `${base}/shuffle`, { enabled: !!enabled }, 'setShuffle');
      },
      setRepeat: (mode) => {
        logCommand('setRepeat', mode);
        return send('PUT', `${base}/repeat`, { mode }, 'setRepeat');
      },
      setShader: (shader) => {
        logCommand('setShader', shader ?? null);
        return send('PUT', `${base}/shader`, { shader: shader ?? null }, 'setShader');
      },
      setVolume: (level) => {
        const clamped = Math.max(0, Math.min(100, Math.round(Number(level) || 0)));
        logCommand('setVolume', clamped);
        return send('PUT', `${base}/volume`, { level: clamped }, 'setVolume');
      },
    },

    lifecycle: {
      reset: () => {}, // remote sessions are reset on the device, not from here
      adoptSnapshot: () => {}, // hand-off goes through the dispatch adopt path
    },

    portability: {
      snapshotForHandoff: () => null, // claiming a remote uses the claim endpoint
      receiveClaim: () => {},
    },

    get capabilities() {
      const item = snapshot()?.currentItem;
      const speed = { available: false, reason: `Playback speed is not supported by ${deviceId}` };
      if (!item) return { seekable: false, live: false, reason: 'Nothing is playing', acked: true, speed };
      if (item.isLive === true) {
        return {
          seekable: false, live: true,
          reason: 'Live playback has no seekable position', acked: true, speed,
        };
      }
      if (!Number.isFinite(item.duration) || item.duration <= 0) {
        return {
          seekable: false, live: false,
          reason: 'Playback duration is unavailable', acked: true, speed,
        };
      }
      return { seekable: true, live: false, reason: null, acked: true, speed };
    },

    destroy() {
      clearPendingSteering();
      detachFleet();
      stopTicker();
    },
  };
}

export default createRemoteSessionController;
