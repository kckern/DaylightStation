import { createIdleSessionSnapshot } from '@shared-contracts/media/shapes.mjs';
import { reduce } from './sessionReducer.js';
import * as qOps from './queueOps.js';
import { pickNextQueueItem } from './advancement.js';
import mediaLog from '../logging/mediaLog.js';

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
        this._playerCallbacks.onPlayRequest?.();
        this._dispatch({ type: 'PLAYER_STATE', playerState: 'playing' });
      },
      pause: () => {
        this._playerCallbacks.onPauseRequest?.();
        this._dispatch({ type: 'PLAYER_STATE', playerState: 'paused' });
      },
      stop: () => {
        this._playerCallbacks.onPauseRequest?.();
        this._dispatch({ type: 'RESET' });
      },
      seekAbs: (seconds) => {
        mediaLog.transportCommand({ action: 'seekAbs', value: seconds, target: 'local' });
        this._playerCallbacks.onSeekRequest?.(seconds);
        this._dispatch({ type: 'UPDATE_POSITION', position: seconds });
      },
      seekRel: (delta) => {
        mediaLog.transportCommand({ action: 'seekRel', value: delta, target: 'local' });
        const current = this._snapshot.position ?? 0;
        this.transport.seekAbs(Math.max(0, current + delta));
      },
      skipNext: () => this._advance('skip-next'),
      skipPrev: () => this._advanceBack(),
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
    this._persist.write(next, { wasPlayingOnUnload: next.state === 'playing' });
    for (const sub of this._subscribers) sub(next);
  }

  queue = {
    playNow: (input, opts) => {
      const next = qOps.playNow(this._snapshot, input, opts);
      this._replaceSnapshotAndLoad(next);
    },
    playNext: (input) => {
      const next = qOps.playNext(this._snapshot, input);
      this._replaceSnapshot(next);
    },
    addUpNext: (input) => {
      const next = qOps.addUpNext(this._snapshot, input);
      this._replaceSnapshot(next);
    },
    add: (input) => {
      const wasEmpty = this._snapshot.queue.items.length === 0;
      const next = qOps.add(this._snapshot, input);
      if (wasEmpty && next.queue.currentIndex === 0) {
        this._replaceSnapshotAndLoad(next);
      } else {
        this._replaceSnapshot(next);
      }
    },
    clear: () => {
      const next = qOps.clear(this._snapshot);
      this._replaceSnapshot(next);
    },
    remove: (queueItemId) => {
      const next = qOps.remove(this._snapshot, queueItemId);
      this._replaceSnapshot(next);
    },
    jump: (queueItemId) => {
      const next = qOps.jump(this._snapshot, queueItemId);
      this._replaceSnapshotAndLoad(next);
    },
    reorder: (input) => {
      const next = qOps.reorder(this._snapshot, input);
      this._replaceSnapshot(next);
    },
  };

  config = {
    setShuffle: (enabled) => this._dispatch({ type: 'SET_CONFIG', patch: { shuffle: !!enabled } }),
    setRepeat: (mode) => {
      if (!['off', 'one', 'all'].includes(mode)) return;
      this._dispatch({ type: 'SET_CONFIG', patch: { repeat: mode } });
    },
    setShader: (shader) => this._dispatch({ type: 'SET_CONFIG', patch: { shader: shader ?? null } }),
    setVolume: (level) => {
      const clamped = Math.max(0, Math.min(100, Math.round(Number(level) || 0)));
      this._dispatch({ type: 'SET_CONFIG', patch: { volume: clamped } });
    },
  };

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
      stalledMs: typeof stalledMs === 'number' ? stalledMs : null,
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

  _advance(_reason) {
    const next = pickNextQueueItem(this._snapshot);
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
