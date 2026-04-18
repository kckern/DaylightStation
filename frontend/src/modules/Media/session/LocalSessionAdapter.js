import { createIdleSessionSnapshot } from '@shared-contracts/media/shapes.mjs';
import { reduce } from './sessionReducer.js';
import * as qOps from './queueOps.js';
import { pickNextQueueItem } from './advancement.js';

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
        this._playerCallbacks.onSeekRequest?.(seconds);
        this._dispatch({ type: 'UPDATE_POSITION', position: seconds });
      },
      seekRel: (delta) => {
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
