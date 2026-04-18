import {
  createIdleSessionSnapshot,
  createEmptyQueueSnapshot,
} from '@shared-contracts/media/shapes.mjs';
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'SessionSource' });
  return _logger;
}

// Canonical session states accepted by validateSessionSnapshot → isSessionState.
const VALID_SESSION_STATES = Object.freeze([
  'idle', 'loading', 'playing', 'paused',
  'buffering', 'stalled', 'ended', 'error', 'ready',
]);

// Raw state strings a player might emit mapped to canonical session states.
// Anything unknown falls back to 'idle' to keep the snapshot valid.
const PLAYER_STATE_MAP = Object.freeze({
  idle: 'idle',
  stopped: 'idle',
  loading: 'loading',
  loaded: 'ready',
  ready: 'ready',
  playing: 'playing',
  play: 'playing',
  paused: 'paused',
  pause: 'paused',
  buffering: 'buffering',
  stalled: 'stalled',
  waiting: 'buffering',
  ended: 'ended',
  finished: 'ended',
  error: 'error',
});

function mapState(raw) {
  if (!raw) return 'idle';
  if (VALID_SESSION_STATES.includes(raw)) return raw;
  const normalized = String(raw).toLowerCase();
  return PLAYER_STATE_MAP[normalized] ?? 'idle';
}

function randomId() {
  // Prefer crypto.randomUUID when available; fall back to a timestamp+random id.
  try {
    if (typeof globalThis !== 'undefined'
      && globalThis.crypto
      && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const DEFAULT_CONFIG = Object.freeze({
  shuffle: false,
  repeat: 'off',
  shader: null,
  volume: 50,
  playbackRate: 1.0,
});

function normalizeConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return { ...DEFAULT_CONFIG };
  const out = { ...DEFAULT_CONFIG };
  if (typeof cfg.shuffle === 'boolean') out.shuffle = cfg.shuffle;
  if (cfg.repeat === 'off' || cfg.repeat === 'one' || cfg.repeat === 'all') {
    out.repeat = cfg.repeat;
  }
  if (cfg.shader === null || typeof cfg.shader === 'string') out.shader = cfg.shader;
  if (typeof cfg.volume === 'number' && cfg.volume >= 0 && cfg.volume <= 100) {
    out.volume = Math.round(cfg.volume);
  }
  if (typeof cfg.playbackRate === 'number' && Number.isFinite(cfg.playbackRate)) {
    out.playbackRate = cfg.playbackRate;
  }
  return out;
}

function buildQueueSnapshot(queue) {
  if (!queue) return createEmptyQueueSnapshot();
  const getQueue = typeof queue.getQueue === 'function' ? queue.getQueue.bind(queue) : null;
  const items = getQueue ? (Array.isArray(getQueue()) ? getQueue() : []) : [];
  const getIndex = typeof queue.getCurrentIndex === 'function'
    ? queue.getCurrentIndex.bind(queue)
    : null;
  const rawIndex = getIndex ? getIndex() : -1;
  const currentIndex = Number.isInteger(rawIndex) ? rawIndex : -1;

  const getUpNext = typeof queue.getUpNextCount === 'function'
    ? queue.getUpNextCount.bind(queue)
    : null;
  const upNextCount = getUpNext
    ? Math.max(0, Number(getUpNext()) | 0)
    : items.filter((it) => it?.priority === 'upNext').length;

  return {
    items: items.map((it) => ({ ...it })),  // shallow copy so consumers don't mutate
    currentIndex,
    upNextCount,
  };
}

/**
 * createSessionSource — adapter that produces SessionSnapshot payloads and
 * bridges queueController/player subscriptions for the session-state
 * publisher.
 *
 * The returned object has two methods:
 *   - `getSnapshot()` — returns a `SessionSnapshot` conforming to §4.1.
 *   - `subscribe({ onChange, onStateTransition })` — registers callbacks on
 *      the underlying sources; returns an unsubscribe that detaches both.
 *
 * Missing/null sources are handled gracefully by returning an idle snapshot.
 *
 * @param {object} opts
 * @param {object} [opts.queueController] — hook exposing getQueue, getCurrentItem, subscribe.
 * @param {object} [opts.player]          — hook exposing getState, getPosition, getDuration, getConfig, subscribe.
 * @param {string} opts.ownerId           — required; used in snapshot.meta.ownerId.
 * @param {string} [opts.sessionId]       — optional; if omitted, a UUID is generated.
 */
export function createSessionSource({
  queueController = null,
  player = null,
  ownerId,
  sessionId,
} = {}) {
  if (!ownerId || typeof ownerId !== 'string') {
    throw new TypeError('createSessionSource: ownerId (non-empty string) is required');
  }
  const sid = sessionId && typeof sessionId === 'string' ? sessionId : randomId();

  function getSnapshot() {
    // If neither source is present, return an idle snapshot.
    if (!player && !queueController) {
      return createIdleSessionSnapshot({ sessionId: sid, ownerId });
    }

    const rawState = typeof player?.getState === 'function' ? player.getState() : 'idle';
    const state = mapState(rawState);

    const currentItem = typeof queueController?.getCurrentItem === 'function'
      ? (queueController.getCurrentItem() ?? null)
      : null;

    const rawPos = typeof player?.getPosition === 'function' ? player.getPosition() : 0;
    const position = typeof rawPos === 'number' && Number.isFinite(rawPos) && rawPos >= 0
      ? rawPos
      : 0;

    const queue = buildQueueSnapshot(queueController);

    const cfg = typeof player?.getConfig === 'function' ? player.getConfig() : null;
    const config = normalizeConfig(cfg);

    return {
      sessionId: sid,
      state,
      currentItem,
      position,
      queue,
      config,
      meta: { ownerId, updatedAt: new Date().toISOString() },
    };
  }

  function subscribe({ onChange, onStateTransition } = {}) {
    const unsubs = [];

    if (queueController && typeof queueController.subscribe === 'function' && typeof onChange === 'function') {
      try {
        const u = queueController.subscribe(() => {
          try { onChange(); } catch (err) {
            logger().warn('onChange-handler-threw', { error: String(err?.message ?? err) });
          }
        });
        if (typeof u === 'function') unsubs.push(u);
      } catch (err) {
        logger().warn('queue-subscribe-failed', { error: String(err?.message ?? err) });
      }
    }

    if (player && typeof player.subscribe === 'function' && typeof onStateTransition === 'function') {
      try {
        const u = player.subscribe((evt) => {
          // Player may emit either a raw state string or an event-shape
          // { state } / { type, state }. Try to extract a state and map it.
          let raw;
          if (typeof evt === 'string') raw = evt;
          else if (evt && typeof evt === 'object') raw = evt.state ?? evt.type;
          try { onStateTransition(mapState(raw)); } catch (err) {
            logger().warn('onStateTransition-handler-threw', { error: String(err?.message ?? err) });
          }
        });
        if (typeof u === 'function') unsubs.push(u);
      } catch (err) {
        logger().warn('player-subscribe-failed', { error: String(err?.message ?? err) });
      }
    }

    return () => {
      for (const u of unsubs) {
        try { u(); } catch (err) {
          logger().warn('unsubscribe-failed', { error: String(err?.message ?? err) });
        }
      }
    };
  }

  return {
    getSnapshot,
    subscribe,
    get sessionId() { return sid; },
    get ownerId() { return ownerId; },
  };
}

export default createSessionSource;
