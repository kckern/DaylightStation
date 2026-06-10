// frontend/src/modules/Media/session/LocalSessionController.js
// The local half of the controller symmetry seam (controllerShape.js): a thin
// facade composing the session store, the pure queue/advancement modules, the
// hot position channel, and the player handle injected by PlayerBridge.
// It holds no state of its own.
import { createIdleSessionSnapshot } from '@shared-contracts/media/shapes.mjs';
import { createSessionStore } from './sessionStore.js';
import { createPositionChannel } from './positionChannel.js';
import * as qOps from './queueOps.js';
import { pickNextQueueItem } from './advancement.js';
import mediaLog from '../logging/mediaLog.js';

function defaultUuid() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* ignore */ }
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function itemFromQueueEntry(entry) {
  return {
    contentId: entry.contentId,
    format: entry.format,
    title: entry.title,
    duration: entry.duration,
    thumbnail: entry.thumbnail,
  };
}

export function createLocalSessionController({
  clientId,
  persistedSnapshot = null,
  randomUuid = defaultUuid,
  nowFn = () => new Date(),
  clearPersisted = () => {},
} = {}) {
  const initial = persistedSnapshot ?? createIdleSessionSnapshot({
    sessionId: randomUuid(),
    ownerId: clientId,
    now: nowFn(),
  });
  const store = createSessionStore(initial);
  const position = createPositionChannel();
  position.set(initial.position ?? 0);

  // PlayerBridge injects the imperative player surface; until it does (or
  // when no media element exists) these are no-ops.
  let player = { play: () => {}, pause: () => {}, seek: () => {} };

  const snap = () => store.getSnapshot();

  // Durable position writes flow down into the hot tier (never the reverse).
  const setDurablePosition = (seconds) => {
    store.dispatch({ type: 'UPDATE_POSITION', position: seconds });
    position.set(seconds);
  };

  const loadCurrent = (snapshot) => {
    const current = snapshot.queue.items[snapshot.queue.currentIndex];
    if (current) {
      store.dispatch({ type: 'LOAD_ITEM', item: itemFromQueueEntry(current) });
      position.set(0);
    }
  };

  const logQueueMutation = (op, next, context = {}) => {
    mediaLog.queueMutated({
      op,
      sessionId: snap().sessionId,
      ...context,
      queueLength: next.queue.items.length,
    });
  };

  const advance = (reason) => {
    const next = pickNextQueueItem(snap());
    mediaLog.playbackAdvanced({
      sessionId: snap().sessionId,
      reason,
      nextContentId: next?.contentId ?? null,
    });
    if (!next) {
      store.dispatch({ type: 'PLAYER_STATE', playerState: 'ended' });
      return;
    }
    const idx = snap().queue.items.findIndex((i) => i.queueItemId === next.queueItemId);
    store.dispatch({
      type: 'REPLACE_QUEUE',
      queue: { items: [...snap().queue.items], currentIndex: idx, upNextCount: snap().queue.upNextCount },
    });
    store.dispatch({ type: 'LOAD_ITEM', item: itemFromQueueEntry(next) });
    position.set(0);
  };

  const advanceBack = () => {
    const prevIdx = Math.max(-1, snap().queue.currentIndex - 1);
    if (prevIdx < 0) return;
    const item = snap().queue.items[prevIdx];
    store.dispatch({
      type: 'REPLACE_QUEUE',
      queue: { items: snap().queue.items, currentIndex: prevIdx, upNextCount: snap().queue.upNextCount },
    });
    store.dispatch({ type: 'LOAD_ITEM', item: itemFromQueueEntry(item) });
    position.set(0);
  };

  const setConfig = (patch) => {
    mediaLog.configChanged({ sessionId: snap().sessionId, patch });
    store.dispatch({ type: 'SET_CONFIG', patch });
  };

  const controller = {
    kind: 'local',
    id: clientId,
    store, // exposed for attachments + provider wiring; not part of the shape

    getSnapshot: () => store.getSnapshot(),
    subscribe: (fn) => store.subscribe(fn),
    position: { get: position.get, subscribe: position.subscribe },

    transport: {
      play: () => {
        mediaLog.transportCommand({ action: 'play', target: 'local' });
        player.play();
        store.dispatch({ type: 'PLAYER_STATE', playerState: 'playing' });
      },
      pause: () => {
        mediaLog.transportCommand({ action: 'pause', target: 'local' });
        player.pause();
        store.dispatch({ type: 'PLAYER_STATE', playerState: 'paused' });
      },
      stop: () => {
        mediaLog.transportCommand({ action: 'stop', target: 'local' });
        player.pause();
        store.dispatch({ type: 'RESET' });
        position.set(0);
      },
      seekAbs: (seconds) => {
        mediaLog.transportCommand({ action: 'seekAbs', value: seconds, target: 'local' });
        player.seek(seconds);
        setDurablePosition(seconds);
      },
      seekRel: (delta) => {
        mediaLog.transportCommand({ action: 'seekRel', value: delta, target: 'local' });
        const current = position.get().seconds ?? snap().position ?? 0;
        controller.transport.seekAbs(Math.max(0, current + delta));
      },
      skipNext: () => {
        mediaLog.transportCommand({ action: 'skipNext', target: 'local' });
        advance('skip-next');
      },
      skipPrev: () => {
        mediaLog.transportCommand({ action: 'skipPrev', target: 'local' });
        advanceBack();
      },
    },

    queue: {
      playNow: (input, opts) => {
        const next = qOps.playNow(snap(), input, opts);
        logQueueMutation('playNow', next, { contentId: input?.contentId });
        store.replace(next);
        loadCurrent(next);
      },
      playNext: (input) => {
        const next = qOps.playNext(snap(), input);
        logQueueMutation('playNext', next, { contentId: input?.contentId });
        store.replace(next);
      },
      addUpNext: (input) => {
        const next = qOps.addUpNext(snap(), input);
        logQueueMutation('addUpNext', next, { contentId: input?.contentId });
        store.replace(next);
      },
      add: (input) => {
        const wasEmpty = snap().queue.items.length === 0;
        const next = qOps.add(snap(), input);
        logQueueMutation('add', next, { contentId: input?.contentId });
        store.replace(next);
        if (wasEmpty && next.queue.currentIndex === 0) loadCurrent(next);
      },
      remove: (queueItemId) => {
        const next = qOps.remove(snap(), queueItemId);
        logQueueMutation('remove', next, { queueItemId });
        store.replace(next);
      },
      reorder: (input) => {
        const next = qOps.reorder(snap(), input);
        logQueueMutation('reorder', next);
        store.replace(next);
      },
      jump: (queueItemId) => {
        const next = qOps.jump(snap(), queueItemId);
        logQueueMutation('jump', next, { queueItemId });
        store.replace(next);
        loadCurrent(next);
      },
      clear: () => {
        const next = qOps.clear(snap());
        logQueueMutation('clear', next);
        store.replace(next);
      },
    },

    config: {
      setShuffle: (enabled) => setConfig({ shuffle: !!enabled }),
      setRepeat: (mode) => {
        if (!['off', 'one', 'all'].includes(mode)) return;
        setConfig({ repeat: mode });
      },
      setShader: (shader) => setConfig({ shader: shader ?? null }),
      setVolume: (level) => {
        const clamped = Math.max(0, Math.min(100, Math.round(Number(level) || 0)));
        setConfig({ volume: clamped });
      },
    },

    lifecycle: {
      reset: () => {
        mediaLog.sessionReset({ sessionId: snap().sessionId });
        clearPersisted();
        store.dispatch({ type: 'RESET', newSessionId: randomUuid() });
        position.set(0);
      },
      adoptSnapshot: (snapshot, { autoplay = true } = {}) => {
        store.dispatch({ type: 'ADOPT_SNAPSHOT', snapshot });
        position.set(snapshot.position ?? 0);
        if (autoplay) controller.transport.play();
      },
    },

    portability: {
      // Position comes from the hot tier — the durable tier can lag by up to
      // 5s, which would blow the C7.3 hand-off tolerance.
      snapshotForHandoff: () => {
        const out = JSON.parse(JSON.stringify(snap()));
        out.position = position.get().seconds ?? out.position;
        return out;
      },
      receiveClaim: (snapshot) => controller.lifecycle.adoptSnapshot(snapshot, { autoplay: true }),
    },

    get capabilities() {
      return { seekable: !snap().currentItem?.isLive, acked: false };
    },

    // ---- PlayerBridge surface (not part of the controller shape) ----
    setPlayerHandle(handle) {
      player = { play: () => {}, pause: () => {}, seek: () => {}, ...handle };
    },
    onPlayerStateChange: (state) => store.dispatch({ type: 'PLAYER_STATE', playerState: state }),
    onPlayerEnded: () => advance('item-ended'),
    onPlayerError: ({ message, code } = {}) => {
      mediaLog.playbackError({
        sessionId: snap().sessionId,
        contentId: snap().currentItem?.contentId,
        error: message ?? 'unknown',
        code: code ?? null,
      });
      store.dispatch({ type: 'ITEM_ERROR', error: message ?? 'unknown', code: code ?? null });
      advance('item-error');
    },
    onPlayerStalled: ({ stalledMs } = {}) => {
      const current = snap().currentItem;
      if (!current) return;
      mediaLog.playbackStallAutoAdvanced({
        sessionId: snap().sessionId,
        contentId: current.contentId,
        stalledMs: Number.isFinite(stalledMs) ? stalledMs : null,
      });
      store.dispatch({ type: 'PLAYER_STATE', playerState: 'stalled' });
      advance('stall-auto-advance');
    },
    /** Durable (≥5s cadence) position write. */
    onPlayerProgress: (seconds) => {
      if (typeof seconds === 'number' && Number.isFinite(seconds)) setDurablePosition(seconds);
    },
    /** Hot-tier tick — feeds ONLY the position channel; snapshot subscribers
     *  do not re-render. */
    onPlayerPositionTick: (seconds) => position.set(seconds),
  };

  return controller;
}

export default createLocalSessionController;
