/**
 * Backend mirror of the strap-sticker color SSOT
 * (frontend/src/modules/Fitness/lib/strapColors.js). Maps a configured strap color
 * NAME (fitness.yml → device_colors.heart_rate) to the SAME hex the live UI uses,
 * so the recap shows each user in their real assigned colour. Keep in sync.
 */
const COLOR_HEX = {
  red: '#ff6b6b', orange: '#ff922b', yellow: '#f0c836', green: '#51cf66',
  blue: '#6ab8ff', purple: '#b07cf7', beige: '#d2b48c', brown: '#a87c4f',
  teal: '#2cc1c1', pink: '#f783ac', white: '#e9ecef', watch: '#e9ecef',
  black: '#868e96', gray: '#adb5bd', grey: '#adb5bd'
};

const norm = (color) => (color == null ? null : String(color).trim().toLowerCase() || null);

export function cssColorForStrap(color) {
  const key = norm(color);
  return key ? (COLOR_HEX[key] || null) : null;
}

// Deterministic fallback for a device with no configured strap colour, so
// simultaneous unknown devices stay visually distinct.
export function hashColorForDevice(deviceId) {
  const str = String(deviceId ?? '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(hash) % 360}, 70%, 55%)`;
}

/**
 * Build a `resolveColor(deviceId) -> hex` from a device_colors.heart_rate map
 * (`{ [deviceId]: colorName }`). Tries the strap colour, else a stable hash.
 */
export function makeDeviceColorResolver(heartRateColors = {}) {
  const map = heartRateColors || {};
  return (deviceId) => {
    if (deviceId == null) return null;
    const name = map[deviceId] ?? map[String(deviceId)] ?? map[Number(deviceId)];
    return cssColorForStrap(name) || hashColorForDevice(deviceId);
  };
}
