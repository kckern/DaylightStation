// frontend/src/modules/Media/peek/RemoteSessionController.js
// The remote half of the controller symmetry seam: same interface as the
// local controller, but commands go over HTTP to the device session API
// (§4.3–4.5) and state comes from the fleet store's device-state feed —
// the device's broadcast is ground truth; this controller holds no session
// state of its own. Returned promises resolve on device ack.
import { DaylightAPI } from '../../../lib/api.mjs';
import { createPositionChannel } from '../session/positionChannel.js';
import mediaLog from '../logging/mediaLog.js';

function uuid() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* ignore */ }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const PLAYING = 'playing';

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

  const reconcilePendingSteering = (entry) => {
    if (!pendingSteering) return;
    if (entry?.offline || entry?.isStale) {
      pendingSteering = null;
      return;
    }
    const identity = freshPlayback(entry);
    // A fresh different identity is evidence that another command or person
    // took over; it may not inherit this acknowledged Play's steering lease.
    if (identity && !samePlayback(pendingSteering, identity)) {
      pendingSteering = null;
      return;
    }
    const playing = freshPlayback(entry, { playingOnly: true });
    if (playing && samePlayback(pendingSteering, playing)) {
      pendingSteering = null;
      reportSteering(playing);
    }
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

  const send = (method, path, body, action) => {
    // A later Play supersedes an earlier command that was still waiting for a
    // debounced playing-state broadcast. Capture its known paused identity so
    // only that exact playback can complete the lease.
    const expectedPlayback = action === 'play' ? freshPlayback(fleetStore.getEntry(deviceId)) : null;
    if (action === 'play') pendingSteering = null;
    const commandId = randomUuid();
    const ackPromise = ackRouter.register(commandId, { action, deviceId });
    const httpPromise = http(path, { ...body, commandId }, method);
    // HTTP failure rejects immediately; otherwise the ack decides.
    return Promise.all([httpPromise, ackPromise]).then(([httpRes]) => {
      const playback = observedPlayback();
      if (action === 'play') {
        if (expectedPlayback && playback && samePlayback(expectedPlayback, playback)) reportSteering(playback);
        else if (expectedPlayback) pendingSteering = expectedPlayback;
      } else if (playback) reportSteering(playback);
      return { ok: true, http: httpRes, commandId };
    });
  };

  const transportPost = (action, value) => {
    logCommand(action, value);
    return send('POST', `${base}/transport`, value !== undefined ? { action, value } : { action }, action);
  };

  return {
    kind: 'remote',
    id: deviceId,

    getSnapshot: snapshot,
    subscribe: (fn) => fleetStore.subscribeDevice(deviceId, (entry) => fn(entry?.snapshot ?? null)),

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
    },

    queue: {
      playNow: (input, opts = {}) =>
        send('POST', `${base}/queue/play-now`, { contentId: input.contentId, clearRest: !!opts.clearRest }, 'queue.playNow'),
      playNext: (input) => send('POST', `${base}/queue/play-next`, { contentId: input.contentId }, 'queue.playNext'),
      addUpNext: (input) => send('POST', `${base}/queue/add-up-next`, { contentId: input.contentId }, 'queue.addUpNext'),
      add: (input) => send('POST', `${base}/queue/add`, { contentId: input.contentId }, 'queue.add'),
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
      return { seekable: !snapshot()?.currentItem?.isLive, acked: true };
    },

    destroy() {
      pendingSteering = null;
      detachFleet();
      stopTicker();
    },
  };
}

export default createRemoteSessionController;
