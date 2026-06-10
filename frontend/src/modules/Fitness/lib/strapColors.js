// Single source of truth for physical strap-sticker colors
// (fitness.yml → device_colors.heart_rate) as they surface in the UI.

const COLOR_EMOJI = {
  red: '❤️', orange: '🧡', yellow: '💛', green: '💚', blue: '💙',
  purple: '💜', beige: '🤎', brown: '🤎', teal: '🩵', pink: '🩷',
  white: '🤍', watch: '🤍', black: '🖤', gray: '🩶', grey: '🩶'
};

const COLOR_HEX = {
  red: '#ff6b6b', orange: '#ff922b', yellow: '#f0c836', green: '#51cf66',
  blue: '#6ab8ff', purple: '#b07cf7', beige: '#d2b48c', brown: '#a87c4f',
  teal: '#2cc1c1', pink: '#f783ac', white: '#e9ecef', watch: '#e9ecef',
  black: '#868e96', gray: '#adb5bd', grey: '#adb5bd'
};

const FALLBACK_EMOJI = '🧡';

const norm = (color) => (color == null ? null : String(color).trim().toLowerCase() || null);

export function heartEmojiForColor(color) {
  const key = norm(color);
  if (!key) return FALLBACK_EMOJI;
  return COLOR_EMOJI[key] || FALLBACK_EMOJI;
}

export function cssColorForStrap(color) {
  const key = norm(color);
  if (!key) return null;
  return COLOR_HEX[key] || null;
}

// Deterministic per-device color for straps with no configured color, so
// simultaneous unknown devices are at least visually distinct (audit §3).
export function hashColorForDevice(deviceId) {
  const str = String(deviceId ?? '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

export function strapLabel(color) {
  const key = norm(color);
  if (!key) return null;
  return `${key.charAt(0).toUpperCase()}${key.slice(1)} strap`;
}
