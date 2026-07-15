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
import { isContainerInput, expandContainerInput } from './containerExpansion.js';
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
    // Display context must survive the LOAD_ITEM round-trip, or currentItem
    // loses the show/album and artist/album that queueOps put on the entry.
    // NowPlayingView reads the entry first today, but pinning the invariant
    // here keeps a future refactor that reads currentItem from silently
    // dropping the context line (the round-2 whitelist bug, third copy).
    ...(entry.containerTitle != null ? { containerTitle: entry.containerTitle } : {}),
    ...(entry.artist != null ? { artist: entry.artist } : {}),
    ...(entry.album != null ? { album: entry.album } : {}),
  };
}

export function createLocalSessionController({
  clientId,
  persistedSnapshot = null,
  randomUuid = defaultUuid,
  nowFn = () => new Date(),
  clearPersisted = () => {},
  fetchImpl = undefined, // container expansion; defaults to globalThis.fetch
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

  // Move the current cursor to `entry` by IDENTITY (jump recomputes the
  // index), demoting the spent current's upNext priority on the way past.
  const moveCurrentTo = (entry) => {
    let working = snap();
    const oldCurrent = working.queue.items[working.queue.currentIndex];
    if (oldCurrent && oldCurrent.priority === 'upNext' && oldCurrent.queueItemId !== entry.queueItemId) {
      working = qOps.demote(working, oldCurrent.queueItemId);
    }
    store.replace(qOps.jump(working, entry.queueItemId));
    store.dispatch({ type: 'LOAD_ITEM', item: itemFromQueueEntry(entry) });
    position.set(0);
  };

  const advance = (reason) => {
    const next = pickNextQueueItem(snap(), { reason });
    mediaLog.playbackAdvanced({
      sessionId: snap().sessionId,
      reason,
      nextContentId: next?.contentId ?? null,
    });
    if (!next) {
      store.dispatch({ type: 'PLAYER_STATE', playerState: 'ended' });
      return;
    }
    moveCurrentTo(next);
  };

  const advanceBack = () => {
    const prevIdx = Math.max(-1, snap().queue.currentIndex - 1);
    if (prevIdx < 0) return;
    moveCurrentTo(snap().queue.items[prevIdx]);
  };

  const setConfig = (patch) => {
    mediaLog.configChanged({ sessionId: snap().sessionId, patch });
    store.dispatch({ type: 'SET_CONFIG', patch });
  };

  // ---- Queue enqueue paths -------------------------------------------------
  // Each applier takes a BATCH of queue inputs (a single item is a batch of
  // one) so container expansion and the plain single-item path share the
  // exact same store mutations.
  const enqueueAppliers = {
    playNow: (inputs, opts, context) => {
      const next = qOps.playNowMany(snap(), inputs, opts);
      logQueueMutation('playNow', next, context);
      store.replace(next);
      loadCurrent(next);
    },
    playNext: (inputs, _opts, context) => {
      const wasEmpty = snap().queue.items.length === 0;
      const next = qOps.playNextMany(snap(), inputs);
      logQueueMutation('playNext', next, context);
      store.replace(next);
      // Play Next into an empty queue starts it (parity with add).
      if (wasEmpty && next.queue.items.length > 0) moveCurrentTo(next.queue.items[0]);
    },
    addUpNext: (inputs, _opts, context) => {
      const next = qOps.addUpNextMany(snap(), inputs);
      logQueueMutation('addUpNext', next, context);
      store.replace(next);
    },
    add: (inputs, _opts, context) => {
      const wasEmpty = snap().queue.items.length === 0;
      const next = qOps.addMany(snap(), inputs);
      logQueueMutation('add', next, context);
      store.replace(next);
      if (wasEmpty && next.queue.currentIndex === 0) loadCurrent(next);
    },
  };

  // Container inputs (album/show/playlist/… — marked by itemType/type/
  // childCount) expand ASYNCHRONOUSLY into their playable children before
  // enqueueing, so "Play album" queues the whole album instead of one track.
  // Non-container inputs take the applier synchronously — exact previous
  // behavior. Expansion failure or zero children degrades to the single-item
  // path: the tap always enqueues SOMETHING.
  const enqueue = (op, input, opts) => {
    const apply = enqueueAppliers[op];
    const context = { contentId: input?.contentId };
    if (!isContainerInput(input)) {
      apply([input], opts, context);
      return;
    }
    expandContainerInput(input, { fetchImpl })
      .then((children) => {
        if (children && children.length > 0) {
          apply(children, opts, {
            ...context,
            expandedFrom: input.contentId,
            expandedCount: children.length,
          });
        } else {
          apply([input], opts, context);
        }
      })
      .catch(() => apply([input], opts, context));
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
        // Playing from a stopped/ready session starts the queue head.
        if (!snap().currentItem) {
          const first = snap().queue.items[0];
          if (!first) return;
          moveCurrentTo(first);
        }
        player.play();
        store.dispatch({ type: 'PLAYER_STATE', playerState: 'playing' });
      },
      pause: () => {
        mediaLog.transportCommand({ action: 'pause', target: 'local' });
        // Flush the hot-tier position durably — pausing is the moment the
        // user expects "their place" to be saved.
        const here = position.get().seconds;
        if (Number.isFinite(here) && here > 0) setDurablePosition(here);
        player.pause();
        store.dispatch({ type: 'PLAYER_STATE', playerState: 'paused' });
      },
      stop: () => {
        mediaLog.transportCommand({ action: 'stop', target: 'local' });
        player.pause();
        // Stop ends playback but does NOT destroy the queue — only the
        // explicit, confirmed reset does that (C2.3 / session state table:
        // stop → 'ready' while items remain, 'idle' when none).
        store.dispatch({ type: 'STOP' });
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
      playNow: (input, opts) => enqueue('playNow', input, opts),
      playNext: (input) => enqueue('playNext', input),
      addUpNext: (input) => enqueue('addUpNext', input),
      add: (input) => enqueue('add', input),
      remove: (queueItemId) => {
        const wasCurrent = snap().queue.items[snap().queue.currentIndex]?.queueItemId === queueItemId;
        const next = qOps.remove(snap(), queueItemId);
        logQueueMutation('remove', next, { queueItemId });
        store.replace(next);
        if (wasCurrent) {
          // Removing the playing item: its successor takes over cleanly, or
          // playback stops when nothing is left.
          const successor = next.queue.items[next.queue.currentIndex];
          if (successor) moveCurrentTo(successor);
          else { player.pause(); store.dispatch({ type: 'STOP' }); position.set(0); }
        }
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
