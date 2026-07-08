/**
 * Parse URL search params into an autoplay command.
 *
 * Each app passes its own supported actions list.
 *
 * @param {string} searchString - URL search string (e.g., '?play=hymn:198&volume=50')
 * @param {string[]} supportedActions - Action keys this app handles (e.g., ['play', 'queue'])
 * @returns {object|null} Parsed command object or null if no action found
 */

/**
 * Canonical list of autoplay/initial-action keys. Single source of truth used
 * by both ScreenAutoplay (parseAutoplayParams supportedActions) and
 * useInitialActionGate (menu-flash suppression). Keep the two consumers in
 * sync by importing from here rather than duplicating the array.
 */
export const AUTOPLAY_ACTIONS = Object.freeze([
  'play', 'queue', 'playlist', 'random',
  'display', 'read', 'open',
  'app', 'launch', 'list',
  'play-next', 'play-now',
]);

const CONFIG_KEYS = [
  'volume', 'shader', 'playbackRate', 'shuffle', 'continuous',
  'repeat', 'loop', 'overlay', 'advance', 'interval', 'mode', 'frame',
  'prewarmToken', 'prewarmContentId',
  'endBehavior', 'endDeviceId', 'endLocation',
];

// Params that ride along in wake-and-load / trigger URLs but are NEVER
// content: envelope routing keys and NFC tag bookkeeping. The alias
// fallback must not turn these into a play action (2026-07-07 bug:
// ?scanned_at=... became contentId 'scanned_at:...' → 404 → stuck Loading).
const PASSTHROUGH_KEYS = new Set([
  'op', 'endBehavior', 'endDeviceId', 'endLocation',
  'scanned_at', 'note', 'dispatchId', 'token',
]);

const BOOLEAN_CONFIG_KEYS = new Set(['shuffle', 'continuous', 'repeat', 'loop']);

function parseBooleanParam(rawValue) {
  if (rawValue === '' || rawValue == null) return true;
  const value = String(rawValue).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return Boolean(rawValue);
}

function toContentId(value) {
  if (/^[a-z]+:.+$/i.test(value)) return value;
  if (/^\d+$/.test(value)) return `plex:${value}`;
  return value;
}

const ACTION_MAPPINGS = {
  playlist: (value, config) => ({ queue: { contentId: toContentId(value), ...config } }),
  queue: (value, config) => {
    if (value.includes(',')) return { compose: { sources: value.split(',').map(s => s.trim()), ...config } };
    if (value.startsWith('app:')) return { compose: { sources: [value], ...config } };
    return { queue: { contentId: toContentId(value), ...config } };
  },
  play: (value, config) => {
    if (value.includes(',')) return { compose: { sources: value.split(',').map(s => s.trim()), ...config } };
    if (value.startsWith('app:')) return { compose: { sources: [value], ...config } };
    return { play: { contentId: toContentId(value), ...config } };
  },
  random: (value, config) => ({ play: { contentId: toContentId(value), random: true, ...config } }),
  // Queue-op form used by WakeAndLoadService's FKB-URL fallback for NFC
  // triggers (?play-next=plex:123&op=play-next). Emitted as media:queue-op —
  // ScreenActionHandler routes it to the active Player or mounts a fresh one.
  'play-next': (value, config) => ({ queueOp: { op: 'play-next', contentId: toContentId(value), ...config } }),
  'play-now': (value, config) => ({ queueOp: { op: 'play-now', contentId: toContentId(value), ...config } }),
  display: (value, config) => ({ display: { id: value, ...config } }),
  read: (value, config) => ({ read: { id: value, ...config } }),
  open: (value) => ({ open: { app: value } }),
  app: (value) => ({ open: { app: value } }),
  launch: (value) => ({ launch: { contentId: toContentId(value) } }),
  list: (value, config) => ({ list: { contentId: toContentId(value), ...config } }),
};

export function parseAutoplayParams(searchString, supportedActions) {
  if (!searchString || !supportedActions?.length) return null;

  const params = new URLSearchParams(searchString);
  const queryEntries = Object.fromEntries(params.entries());
  if (Object.keys(queryEntries).length === 0) return null;

  // Extract config modifiers
  const config = {};
  for (const configKey of CONFIG_KEYS) {
    if (queryEntries[configKey] != null) {
      if (configKey === 'overlay') {
        config.overlay = {
          queue: { contentId: toContentId(queryEntries[configKey]) },
          shuffle: true
        };
      } else if (BOOLEAN_CONFIG_KEYS.has(configKey)) {
        config[configKey] = parseBooleanParam(queryEntries[configKey]);
      } else {
        config[configKey] = queryEntries[configKey];
      }
    }
  }

  // Backward-compatible alias: loop uses the same behavior as continuous.
  if (config.loop != null && config.continuous == null) {
    config.continuous = Boolean(config.loop);
  }

  // Parse advance as structured object
  if (queryEntries.advance) {
    config.advance = {
      mode: queryEntries.advance,
      interval: parseInt(queryEntries.interval) || 5000
    };
  }

  // Parse track modifiers (e.g., ?loop.audio=0&shuffle.visual=1)
  const trackModifiers = { visual: {}, audio: {} };
  for (const [key, value] of Object.entries(queryEntries)) {
    const match = key.match(/^(\w+)\.(visual|audio)$/);
    if (match) {
      const [, modifier, track] = match;
      trackModifiers[track][modifier] = value;
    }
  }
  if (Object.keys(trackModifiers.visual).length || Object.keys(trackModifiers.audio).length) {
    config.trackModifiers = trackModifiers;
  }

  // Match first supported action key
  for (const [key, value] of Object.entries(queryEntries)) {
    if (supportedActions.includes(key) && ACTION_MAPPINGS[key]) {
      return ACTION_MAPPINGS[key](value, config);
    }
  }

  // Alias fallback: unknown key -> play key:value
  for (const [key, value] of Object.entries(queryEntries)) {
    if (CONFIG_KEYS.includes(key) || PASSTHROUGH_KEYS.has(key) || key.includes('.')) continue;
    return { play: { contentId: `${key}:${value}`, ...config } };
  }

  return null;
}

/**
 * Map a parseAutoplayParams result to an ActionBus (event, payload) pair.
 * Single source of truth for the ScreenAutoplay dispatch chain — priority
 * order mirrors the original inline if/else in ScreenRenderer.jsx.
 * Returns null when there is nothing to emit.
 */
export function autoplayToAction(autoplay) {
  if (!autoplay) return null;
  if (autoplay.compose) return { event: 'media:queue', payload: { compose: true, sources: autoplay.compose.sources, ...autoplay.compose } };
  if (autoplay.queue) return { event: 'media:queue', payload: { contentId: autoplay.queue.contentId, ...autoplay.queue } };
  if (autoplay.play) return { event: 'media:play', payload: { contentId: autoplay.play.contentId, ...autoplay.play } };
  if (autoplay.queueOp) return { event: 'media:queue-op', payload: autoplay.queueOp };
  if (autoplay.display) return { event: 'display:content', payload: autoplay.display };
  if (autoplay.read) return { event: 'display:content', payload: { ...autoplay.read, mode: 'reader' } };
  if (autoplay.launch) return { event: 'media:play', payload: { contentId: autoplay.launch.contentId, ...autoplay.launch } };
  if (autoplay.open) return { event: 'menu:open', payload: { menuId: autoplay.open.app } };
  if (autoplay.list) return { event: 'menu:open', payload: { menuId: autoplay.list.contentId } };
  return null;
}

export default parseAutoplayParams;
