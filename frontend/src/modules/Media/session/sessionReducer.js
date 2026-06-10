import { createIdleSessionSnapshot, createEmptyQueueSnapshot } from '@shared-contracts/media/shapes.mjs';

const PLAYER_STATE_MAP = {
  idle: 'idle',
  stopped: 'idle',
  loading: 'loading',
  ready: 'ready',
  loaded: 'ready',
  playing: 'playing',
  paused: 'paused',
  buffering: 'buffering',
  stalled: 'stalled',
  ended: 'ended',
  error: 'error',
};

function touch(snapshot, patch) {
  return {
    ...snapshot,
    ...patch,
    meta: {
      ...snapshot.meta,
      ...(patch.meta || {}),
      updatedAt: nextUpdatedAt(snapshot.meta?.updatedAt),
    },
  };
}

// ISO strings only have ms resolution — when reductions happen faster than
// 1ms apart, two `new Date().toISOString()` calls can return the same value.
// Ensure strictly increasing timestamps by bumping 1ms when we'd otherwise
// collide with the previous value.
function nextUpdatedAt(prev) {
  const nowMs = Date.now();
  const prevMs = prev ? Date.parse(prev) : NaN;
  const ms = Number.isFinite(prevMs) && prevMs >= nowMs ? prevMs + 1 : nowMs;
  return new Date(ms).toISOString();
}

export function reduce(snapshot, action) {
  switch (action.type) {
    case 'LOAD_ITEM':
      return touch(snapshot, {
        state: 'loading',
        currentItem: action.item,
        position: 0,
      });

    case 'PLAYER_STATE': {
      const mapped = PLAYER_STATE_MAP[action.playerState] ?? snapshot.state;
      return touch(snapshot, { state: mapped });
    }

    case 'UPDATE_POSITION':
      return touch(snapshot, { position: action.position });

    case 'ITEM_ENDED':
      return touch(snapshot, { state: 'ended' });

    case 'ITEM_ERROR':
      return touch(snapshot, {
        state: 'error',
        meta: { lastError: { message: action.error, code: action.code } },
      });

    case 'SET_CONFIG':
      return touch(snapshot, {
        config: { ...snapshot.config, ...action.patch },
      });

    case 'REPLACE_QUEUE':
      return touch(snapshot, { queue: action.queue });

    case 'SET_CURRENT_ITEM':
      return touch(snapshot, { currentItem: action.item, position: 0, state: 'loading' });

    case 'ADOPT_SNAPSHOT':
      return touch(action.snapshot, {});

    case 'RESET': {
      const fresh = createIdleSessionSnapshot({
        sessionId: action.newSessionId ?? snapshot.sessionId,
        ownerId: snapshot.meta.ownerId,
      });
      return fresh;
    }

    default:
      return snapshot;
  }
}
