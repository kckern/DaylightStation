/**
 * Parse URL search params into an autoplay command.
 *
 * Each app passes its own supported actions list.
 *
 * @param {string} searchString - URL search string (e.g., '?play=hymn:198&volume=50')
 * @param {string[]} supportedActions - Action keys this app handles (e.g., ['play', 'queue'])
 * @returns {object|null} Parsed command object or null if no action found
 */

const CONFIG_KEYS = [
  'volume', 'shader', 'playbackRate', 'shuffle', 'continuous',
  'repeat', 'loop', 'overlay', 'advance', 'interval', 'mode', 'frame',
  'prewarmToken', 'prewarmContentId'
];

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
      } else {
        config[configKey] = queryEntries[configKey];
      }
    }
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
    if (!CONFIG_KEYS.includes(key) && !key.includes('.')) {
      return { play: { contentId: `${key}:${value}`, ...config } };
    }
  }

  return null;
}

export default parseAutoplayParams;
