import { createIdleSessionSnapshot } from '@shared-contracts/media/shapes.mjs';
import { reduce } from './sessionReducer.js';
import * as qOps from './queueOps.js';
import { pickNextQueueItem } from './advancement.js';
import mediaLog from '../logging/mediaLog.js';
import { recordRecent } from './recents.js';

function defaultUuid() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* ignore */ }
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class LocalSessionAdapter {
  constructor({
    clientId,
    wsSend = () => {},
    httpClient = async () => ({}),
    persistence = { read: () => null, write: () => ({ ok: true }), clear: () => {} },
    nowFn = () => new Date(),
    randomUuid = defaultUuid,
  } = {}) {
    this._clientId = clientId;
    this._wsSend = wsSend;
    this._http = httpClient;
    this._persist = persistence;
    this._now = nowFn;
    this._randomUuid = randomUuid;
    this._subscribers = new Set();
    this._playerCallbacks = {
      onPlayRequest: () => {},
      onPauseRequest: () => {},
      onSeekRequest: () => {},
    };

    // Bootstrap: hydrate from persistence or create fresh idle snapshot
    const persisted = this._persist.read();
    if (persisted && persisted !== 'schema-mismatch') {
      this._snapshot = persisted.snapshot;
    } else {
      this._snapshot = createIdleSessionSnapshot({
        sessionId: this._randomUuid(),
        ownerId: this._clientId,
        now: this._now(),
      });
    }

    // Bind transport so destructuring works
    this.transport = {
      play: () => {
        mediaLog.transportCommand({ action: 'play', target: 'local' });
        this._playerCallbacks.onPlayRequest?.();
        this._dispatch({ type: 'PLAYER_STATE', playerState: 'playing' });
      },
      pause: () => {
        mediaLog.transportCommand({ action: 'pause', target: 'local' });
        this._playerCallbacks.onPauseRequest?.();
        this._dispatch({ type: 'PLAYER_STATE', playerState: 'paused' });
      },
      stop: () => {
        mediaLog.transportCommand({ action: 'stop', target: 'local' });
        this._playerCallbacks.onPauseRequest?.();
        this._dispatch({ type: 'RESET' });
      },
      seekAbs: (seconds) => {
        mediaLog.transportCommand({ action: 'seekAbs', value: seconds, target: 'local' });
        this._playerCallbacks.onSeekRequest?.(seconds);
        this._dispatch({ type: 'UPDATE_POSITION', position: seconds });
      },
      seekRel: (delta) => {
        // Emits two transport events: seekRel (user intent) + seekAbs (resolved absolute target).
        mediaLog.transportCommand({ action: 'seekRel', value: delta, target: 'local' });
        const current = this._snapshot.position ?? 0;
        this.transport.seekAbs(Math.max(0, current + delta));
      },
      skipNext: () => {
        mediaLog.transportCommand({ action: 'skipNext', target: 'local' });
        this._advance('skip-next');
      },
      skipPrev: () => {
        mediaLog.transportCommand({ action: 'skipPrev', target: 'local' });
        this._advanceBack();
      },
    };
  }

  getSnapshot() {
    return this._snapshot;
  }

  subscribe(listener) {
    this._subscribers.add(listener);
    return () => this._subscribers.delete(listener);
  }

  setPlayerCallbacks(callbacks) {
    this._playerCallbacks = { ...this._playerCallbacks, ...callbacks };
  }

  _dispatch(action) {
    const prev = this._snapshot;
    const next = reduce(prev, action);
    if (next === prev) return;
    this._snapshot = next;
    if (next.state !== prev.state) {
      mediaLog.sessionStateChange({
        sessionId: next.sessionId,
        prevState: prev.state,
        nextState: next.state,
      });
    }
    // Record a recent when: (a) transitioning into 'playing', or
    // (b) a new LOAD_ITEM arrives (item queued, even before player fires 'playing').
    const itemChanged = next.currentItem?.contentId !== prev.currentItem?.contentId;
    const nowPlaying = next.state === 'playing' && prev.state !== 'playing';
    if (nowPlaying) {
      mediaLog.playbackStarted({
        sessionId: next.sessionId,
        contentId: next.currentItem?.contentId,
      });
    }
    if ((nowPlaying || (itemChanged && next.currentItem)) && next.currentItem) {
      recordRecent({
        contentId: next.currentItem.contentId,
        title: next.currentItem.title,
        thumbnail: next.currentItem.thumbnail,
        format: next.currentItem.format,
      });
    }
    this._persist.write(next, { wasPlayingOnUnload: next.state === 'playing' });
    for (const sub of this._subscribers) sub(next);
  }

  queue = {
    playNow: (input, opts) => {
      const next = qOps.playNow(this._snapshot, input, opts);
      this._logQueueMutation('playNow', next, { contentId: input?.contentId });
      this._replaceSnapshotAndLoad(next);
    },
    playNext: (input) => {
      const next = qOps.playNext(this._snapshot, input);
      this._logQueueMutation('playNext', next, { contentId: input?.contentId });
      this._replaceSnapshot(next);
    },
    addUpNext: (input) => {
      const next = qOps.addUpNext(this._snapshot, input);
      this._logQueueMutation('addUpNext', next, { contentId: input?.contentId });
      this._replaceSnapshot(next);
    },
    add: (input) => {
      const wasEmpty = this._snapshot.queue.items.length === 0;
      const next = qOps.add(this._snapshot, input);
      this._logQueueMutation('add', next, { contentId: input?.contentId });
      if (wasEmpty && next.queue.currentIndex === 0) {
        this._replaceSnapshotAndLoad(next);
      } else {
        this._replaceSnapshot(next);
      }
    },
    clear: () => {
      const next = qOps.clear(this._snapshot);
      this._logQueueMutation('clear', next);
      this._replaceSnapshot(next);
    },
    remove: (queueItemId) => {
      const next = qOps.remove(this._snapshot, queueItemId);
      this._logQueueMutation('remove', next, { queueItemId });
      this._replaceSnapshot(next);
    },
    jump: (queueItemId) => {
      const next = qOps.jump(this._snapshot, queueItemId);
      this._logQueueMutation('jump', next, { queueItemId });
      this._replaceSnapshotAndLoad(next);
    },
    reorder: (input) => {
      const next = qOps.reorder(this._snapshot, input);
      this._logQueueMutation('reorder', next);
      this._replaceSnapshot(next);
    },
  };

  _logQueueMutation(op, next, context = {}) {
    mediaLog.queueMutated({
      op,
      sessionId: this._snapshot.sessionId,
      ...context,
      queueLength: next.queue.items.length,
    });
  }

  config = {
    setShuffle: (enabled) => this._setConfig({ shuffle: !!enabled }),
    setRepeat: (mode) => {
      if (!['off', 'one', 'all'].includes(mode)) return;
      this._setConfig({ repeat: mode });
    },
    setShader: (shader) => this._setConfig({ shader: shader ?? null }),
    setVolume: (level) => {
      const clamped = Math.max(0, Math.min(100, Math.round(Number(level) || 0)));
      this._setConfig({ volume: clamped });
    },
  };

  _setConfig(patch) {
    mediaLog.configChanged({ sessionId: this._snapshot.sessionId, patch });
    this._dispatch({ type: 'SET_CONFIG', patch });
  }

  lifecycle = {
    reset: () => {
      this._persist.clear();
      this._dispatch({ type: 'RESET', newSessionId: this._randomUuid() });
    },
    adoptSnapshot: (snapshot, { autoplay = true } = {}) => {
      this._dispatch({ type: 'ADOPT_SNAPSHOT', snapshot });
      if (autoplay) this.transport.play();
    },
  };

  portability = {
    snapshotForHandoff: () => JSON.parse(JSON.stringify(this._snapshot)),
    receiveClaim: (snapshot) => this.lifecycle.adoptSnapshot(snapshot, { autoplay: true }),
  };

  onPlayerEnded() {
    this._advance('item-ended');
  }

  onPlayerError({ message, code } = {}) {
    this._dispatch({ type: 'ITEM_ERROR', error: message ?? 'unknown', code: code ?? null });
    this._advance('item-error');
  }

  onPlayerStalled({ stalledMs } = {}) {
    const current = this._snapshot.currentItem;
    if (!current) return;
    mediaLog.playbackStallAutoAdvanced({
      sessionId: this._snapshot.sessionId,
      contentId: current.contentId,
      stalledMs: Number.isFinite(stalledMs) ? stalledMs : null,
    });
    this._dispatch({ type: 'PLAYER_STATE', playerState: 'stalled' });
    this._advance('stall-auto-advance');
  }

  onPlayerStateChange(state) {
    this._dispatch({ type: 'PLAYER_STATE', playerState: state });
  }

  onPlayerProgress(positionSeconds) {
    if (typeof positionSeconds === 'number' && Number.isFinite(positionSeconds)) {
      this._dispatch({ type: 'UPDATE_POSITION', position: positionSeconds });
    }
  }

  /**
   * High-frequency position update for live UI (seek bar). Mutates the
   * in-memory snapshot and notifies subscribers but deliberately skips
   * persistence — the 5s onPlayerProgress path remains the durable write.
   */
  onPlayerPositionTick(positionSeconds) {
    if (typeof positionSeconds !== 'number' || !Number.isFinite(positionSeconds)) return;
    const prev = this._snapshot;
    if (Math.abs((prev.position ?? 0) - positionSeconds) < 0.5) return;
    this._snapshot = { ...prev, position: positionSeconds };
    for (const sub of this._subscribers) sub(this._snapshot);
  }

  _replaceSnapshot(next) {
    if (next === this._snapshot) return;
    this._snapshot = next;
    this._persist.write(next, { wasPlayingOnUnload: next.state === 'playing' });
    for (const sub of this._subscribers) sub(next);
  }

  _replaceSnapshotAndLoad(next) {
    this._replaceSnapshot(next);
    const current = next.queue.items[next.queue.currentIndex];
    if (current) {
      this._dispatch({ type: 'LOAD_ITEM', item: {
        contentId: current.contentId, format: current.format,
        title: current.title, duration: current.duration, thumbnail: current.thumbnail,
      } });
    }
  }

  _advance(reason) {
    const next = pickNextQueueItem(this._snapshot);
    mediaLog.playbackAdvanced({
      sessionId: this._snapshot.sessionId,
      reason,
      nextContentId: next?.contentId ?? null,
    });
    if (!next) {
      this._dispatch({ type: 'PLAYER_STATE', playerState: 'ended' });
      return;
    }
    const idx = this._snapshot.queue.items.findIndex(
      (i) => i.queueItemId === next.queueItemId,
    );
    this._dispatch({
      type: 'REPLACE_QUEUE',
      queue: {
        items: [...this._snapshot.queue.items],
        currentIndex: idx,
        upNextCount: this._snapshot.queue.upNextCount,
      },
    });
    this._dispatch({
      type: 'LOAD_ITEM',
      item: {
        contentId: next.contentId,
        format: next.format,
        title: next.title,
        duration: next.duration,
        thumbnail: next.thumbnail,
      },
    });
  }

  _advanceBack() {
    const prev = Math.max(-1, this._snapshot.queue.currentIndex - 1);
    if (prev < 0) return;
    const item = this._snapshot.queue.items[prev];
    this._dispatch({
      type: 'REPLACE_QUEUE',
      queue: {
        items: this._snapshot.queue.items,
        currentIndex: prev,
        upNextCount: this._snapshot.queue.upNextCount,
      },
    });
    this._dispatch({
      type: 'LOAD_ITEM',
      item: {
        contentId: item.contentId,
        format: item.format,
        title: item.title,
        duration: item.duration,
        thumbnail: item.thumbnail,
      },
    });
  }
}

export default LocalSessionAdapter;
