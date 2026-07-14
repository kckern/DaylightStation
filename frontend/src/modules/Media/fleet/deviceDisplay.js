// frontend/src/modules/Media/fleet/deviceDisplay.js
// Single source of truth for how a playback device is presented to humans.
// Raw device ids (kebab-case) must never reach the UI: prefer the configured
// `name`, else humanize the id. Icons come from config `icon` (emoji string),
// else a type-based default.

// Words that must render as-is (case-sensitive) when humanizing an id.
const WORD_OVERRIDES = {
  tv: 'TV',
  pc: 'PC',
  av: 'AV',
  hq: 'HQ',
  livingroom: 'Living Room',
  yellowroom: 'Yellow Room',
};

const TYPE_ICONS = {
  'shield-tv': '📺',
  'linux-pc': '🖥️',
  'android-tablet': '📱',
  'midi-keyboard': '🎹',
  speaker: '🔊',
  'speaker-lane': '🔊',
};

const DEFAULT_ICON = '📺';

/**
 * Human-readable device name. Uses configured `name` when present, otherwise
 * humanizes the kebab-case id ("livingroom-tv" → "Living Room TV").
 * @param {{id?: string, name?: string}|null} device
 * @param {string} [fallbackId] - id to humanize when device is null/partial
 */
export function deviceName(device, fallbackId) {
  const name = device?.name;
  if (typeof name === 'string' && name.trim()) return name.trim();
  const id = device?.id ?? fallbackId ?? '';
  if (!id) return 'Unknown device';
  return String(id)
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => WORD_OVERRIDES[w.toLowerCase()] ?? (w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * Icon (emoji string) for a device: configured `icon` wins, else a default
 * for the device `type`, else a generic screen.
 * @param {{icon?: string, type?: string}|null} device
 */
export function deviceIcon(device) {
  const icon = device?.icon;
  if (typeof icon === 'string' && icon.trim()) return icon.trim();
  return TYPE_ICONS[device?.type] ?? DEFAULT_ICON;
}

/**
 * Location sub-label ("Living Room"), empty string when unconfigured.
 * @param {{location?: string}|null} device
 */
export function deviceLocation(device) {
  const loc = device?.location;
  return typeof loc === 'string' ? loc.trim() : '';
}

export default { deviceName, deviceIcon, deviceLocation };
