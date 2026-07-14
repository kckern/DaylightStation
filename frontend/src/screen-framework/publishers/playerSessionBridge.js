// frontend/src/screen-framework/publishers/playerSessionBridge.js
//
// createPlayerSessionBridge — adapts the legacy Player's imperative handle
// (modules/Player forwardRef: getMediaElement/getCurrentTime/getDuration/
// getVolume/getPlaybackRate/getNowPlaying) into the registry contract that
// SessionSource understands:
//   player          — { getState, getPosition, getDuration, getConfig, subscribe }
//   queueController — { getQueue, getCurrentItem, getCurrentIndex, subscribe }
//
// Seam notes (why the media element, not getPlaybackState()):
//   Player.getPlaybackState() reads controllerRef, which is only populated
//   when the play prop carries its own onController — usually null on screens.
//   Player.getMediaElement() (_getMediaElFallback) is the reliable reader: it
//   covers renderer media (onMediaRef), controller transports AND content
//   renderers (readalong etc.) that register via onRegisterMediaAccess.
//
// The bridge runs a single poll (default 1s): it registers/unregisters with
// the registry as the handle appears/disappears, and fires the player/queue
// subscriber callbacks only on actual state or item-identity changes (so the
// publisher's 500ms-debounced `change` publishes stay quiet during steady
// playback; the 5s heartbeat carries position updates).
//
// Everything is wrapped in try/catch — a broken bridge must never crash a
// screen (same defensive posture as SessionSource).
import getLogger from '../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'playerSessionBridge' });
  return _logger;
}

const DEFAULT_POLL_MS = 1000;

// Mirror of shared/contracts/media/shapes.mjs FORMATS (not exported there).
const KNOWN_FORMATS = new Set([
  'video', 'dash_video', 'audio', 'singalong', 'readalong',
  'readable_paged', 'readable_flow', 'app', 'image', 'composite',
]);

const MEDIA_TYPE_TO_FORMAT = {
  audio: 'audio',
  video: 'video',
  image: 'image',
};

const firstString = (...candidates) => {
  for (const c of candidates) {
    if (c != null && String(c).length > 0) return String(c);
  }
  return null;
};

/**
 * Normalize legacy Player meta (the /play response shape) into a
 * contract-valid PlayableItem: { contentId, format, title?, thumbnail?,
 * duration? }. Returns null when no identity can be derived.
 *
 * @param {object|null} meta — effectiveMeta from the Player (title, thumbnail,
 *   image, duration, format, mediaType, id/assetId/plex/contentId).
 * @param {object|null} hint — static fallback (e.g. the play/queue prop the
 *   player was mounted with), used when meta hasn't resolved yet.
 */
export function normalizePlayableItem(meta, hint = null) {
  const src = (meta && typeof meta === 'object') ? meta : null;
  const fallback = (hint && typeof hint === 'object') ? hint : null;
  if (!src && !fallback) return null;

  const contentId = firstString(
    src?.contentId, src?.assetId, src?.id, src?.plex, src?.key,
    fallback?.contentId, fallback?.assetId, fallback?.plex, fallback?.id,
  );
  if (!contentId) return null;

  const rawFormat = src?.format ?? fallback?.format;
  const mediaType = src?.mediaType ?? fallback?.mediaType;
  const format = KNOWN_FORMATS.has(rawFormat)
    ? rawFormat
    : (MEDIA_TYPE_TO_FORMAT[mediaType] ?? 'video');

  const item = { contentId, format };

  const title = firstString(src?.title, src?.label, fallback?.title, fallback?.label);
  if (title) item.title = title;

  const thumbnail = firstString(src?.thumbnail, src?.image, fallback?.thumbnail, fallback?.image);
  if (thumbnail) item.thumbnail = thumbnail;

  const duration = Number(src?.duration ?? fallback?.duration);
  if (Number.isFinite(duration) && duration > 0) item.duration = duration;

  return item;
}

/**
 * @param {object} opts
 * @param {function} opts.getPlayerHandle — returns the Player imperative
 *   handle (ref.current) or null when no player is mounted.
 * @param {object}   opts.registry        — playerSessionRegistry instance.
 * @param {function} [opts.getItemHint]   — returns a static item fallback
 *   (mount props) used until the player resolves real metadata.
 * @param {number}   [opts.pollMs]
 * @param {function} [opts.setIntervalFn] / [opts.clearIntervalFn] — test seams.
 */
export function createPlayerSessionBridge({
  getPlayerHandle,
  registry,
  getItemHint = null,
  pollMs = DEFAULT_POLL_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  if (typeof getPlayerHandle !== 'function') {
    throw new TypeError('createPlayerSessionBridge: getPlayerHandle (function) is required');
  }
  if (!registry || typeof registry.registerPlayerSession !== 'function') {
    throw new TypeError('createPlayerSessionBridge: registry is required');
  }

  let timer = null;
  let unregister = null;
  const playerSubs = new Set();
  const queueSubs = new Set();
  let lastState = null;
  let lastItemKey = null;

  const readHandle = () => {
    try {
      return getPlayerHandle() ?? null;
    } catch {
      return null;
    }
  };

  const readHint = () => {
    if (typeof getItemHint !== 'function') return null;
    try {
      return getItemHint() ?? null;
    } catch {
      return null;
    }
  };

  const readMediaEl = () => {
    const handle = readHandle();
    if (!handle) return null;
    try {
      return handle.getMediaElement?.() ?? null;
    } catch {
      return null;
    }
  };

  const readNowPlayingMeta = () => {
    const handle = readHandle();
    if (!handle) return null;
    try {
      const np = handle.getNowPlaying?.();
      return np?.item ?? null;
    } catch {
      return null;
    }
  };

  const getState = () => {
    const handle = readHandle();
    if (!handle) return 'idle';
    const el = readMediaEl();
    // No media element yet (still resolving /play, or a non-AV format like an
    // image slideshow) — report loading rather than lying about playback.
    if (!el) return 'loading';
    try {
      if (el.ended) return 'ended';
      if (el.paused) return 'paused';
      return 'playing';
    } catch {
      return 'loading';
    }
  };

  const getPosition = () => {
    const handle = readHandle();
    if (!handle) return 0;
    try {
      const t = handle.getCurrentTime?.();
      return Number.isFinite(t) && t >= 0 ? t : 0;
    } catch {
      return 0;
    }
  };

  const getDuration = () => {
    const handle = readHandle();
    if (!handle) return null;
    try {
      const d = handle.getDuration?.();
      return Number.isFinite(d) && d > 0 ? d : null;
    } catch {
      return null;
    }
  };

  const getConfig = () => {
    const handle = readHandle();
    if (!handle) return null;
    const config = {};
    try {
      const v = handle.getVolume?.();
      if (Number.isFinite(v)) {
        // Player session volume is 0..1; the snapshot contract wants 0..100.
        config.volume = Math.round(v <= 1 ? v * 100 : Math.min(100, v));
      }
    } catch { /* ignore */ }
    try {
      const r = handle.getPlaybackRate?.();
      if (Number.isFinite(r)) config.playbackRate = r;
    } catch { /* ignore */ }
    return config;
  };

  const getCurrentItem = () => {
    const item = normalizePlayableItem(readNowPlayingMeta(), readHint());
    if (!item) return null;
    if (item.duration == null) {
      const d = getDuration();
      if (d != null) item.duration = d;
    }
    return item;
  };

  const getCurrentIndex = () => {
    const handle = readHandle();
    if (!handle) return -1;
    try {
      const np = handle.getNowPlaying?.();
      const idx = np?.queuePosition;
      return Number.isInteger(idx) && idx >= 0 ? idx : (getCurrentItem() ? 0 : -1);
    } catch {
      return -1;
    }
  };

  const player = {
    getState,
    getPosition,
    getDuration,
    getConfig,
    subscribe(cb) {
      if (typeof cb !== 'function') return () => {};
      playerSubs.add(cb);
      return () => playerSubs.delete(cb);
    },
  };

  const queueController = {
    getCurrentItem,
    getQueue: () => [],
    getCurrentIndex,
    subscribe(cb) {
      if (typeof cb !== 'function') return () => {};
      queueSubs.add(cb);
      return () => queueSubs.delete(cb);
    },
  };

  const emitPlayer = (state) => {
    for (const cb of [...playerSubs]) {
      try { cb(state); } catch (err) {
        logger().warn('player-subscriber-threw', { error: String(err?.message ?? err) });
      }
    }
  };

  const emitQueue = () => {
    for (const cb of [...queueSubs]) {
      try { cb(); } catch (err) {
        logger().warn('queue-subscriber-threw', { error: String(err?.message ?? err) });
      }
    }
  };

  const tick = () => {
    try {
      const handle = readHandle();

      if (handle && !unregister) {
        unregister = registry.registerPlayerSession({ player, queueController });
        lastState = null;
        lastItemKey = null;
      } else if (!handle && unregister) {
        try { unregister(); } catch { /* ignore */ }
        unregister = null;
        lastState = null;
        lastItemKey = null;
        return;
      }

      if (!handle) return;

      const state = getState();
      if (state !== lastState) {
        lastState = state;
        emitPlayer(state);
      }

      const item = getCurrentItem();
      const itemKey = item ? `${item.contentId}|${item.title ?? ''}` : null;
      if (itemKey !== lastItemKey) {
        lastItemKey = itemKey;
        emitQueue();
      }
    } catch (err) {
      logger().warn('tick-failed', { error: String(err?.message ?? err) });
    }
  };

  return {
    start() {
      if (timer) return;
      timer = setIntervalFn(tick, pollMs);
      tick();
    },
    stop() {
      if (timer) {
        try { clearIntervalFn(timer); } catch { /* ignore */ }
        timer = null;
      }
      if (unregister) {
        try { unregister(); } catch { /* ignore */ }
        unregister = null;
      }
      lastState = null;
      lastItemKey = null;
    },
    // Exposed for tests / diagnostics.
    player,
    queueController,
  };
}

export default createPlayerSessionBridge;
