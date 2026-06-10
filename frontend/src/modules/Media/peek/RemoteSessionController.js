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
}) {
  const base = `api/v1/device/${deviceId}/session`;
  const position = createPositionChannel();

  const snapshot = () => fleetStore.getEntry(deviceId)?.snapshot ?? null;

  // Hot position tier for remote sessions: seeded from each broadcast,
  // extrapolated at 1Hz while playing — but only while someone is actually
  // watching (a seek bar is subscribed).
  let posSubscribers = 0;
  let ticker = null;
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

  const detachFleet = fleetStore.subscribeDevice(deviceId, (entry) => {
    syncFromSnapshot(entry?.snapshot);
  });
  syncFromSnapshot(snapshot());

  const logCommand = (action, value) => {
    mediaLog.peekCommand({ deviceId, action, ...(value !== undefined ? { value } : {}) });
  };

  const send = (method, path, body, action) => {
    const commandId = randomUuid();
    const ackPromise = ackRouter.register(commandId, { action, deviceId });
    const httpPromise = http(path, { ...body, commandId }, method);
    // HTTP failure rejects immediately; otherwise the ack decides.
    return Promise.all([httpPromise, ackPromise]).then(([httpRes]) => ({ ok: true, http: httpRes, commandId }));
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
      detachFleet();
      stopTicker();
    },
  };
}

export default createRemoteSessionController;
