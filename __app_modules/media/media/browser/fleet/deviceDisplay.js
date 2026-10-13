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

/** What a browser nobody has named is called, wherever it is shown. */
export const UNNAMED_BROWSER = 'a browser';

// A name the app made up ("Browser 4778f429") or a raw browser/ephemeral id
// ("browser:4778f429-…") is a machine hash, never something to show a person.
const PLACEHOLDER_NAME = /^Browser ([0-9a-f]{8}|browser-)$/i;
const RAW_BROWSER_ID = /^(browser|ephemeral)[:-][0-9a-zA-Z-]{4,}$/i;
// A bare id with its prefix sliced off ("4778f429aa11", a uuid).
const BARE_HASH = /^(?=.*[0-9a-f]{8})[0-9a-f-]{12,}$/i;

/** True for a hash-shaped label that must not reach the UI. */
export function isMachineDeviceLabel(label) {
  const text = typeof label === 'string' ? label.trim() : '';
  return PLACEHOLDER_NAME.test(text) || RAW_BROWSER_ID.test(text) || BARE_HASH.test(text);
}

/**
 * THE one place a device label becomes display text. A real name passes
 * through; a hash-shaped or missing label reads `fallback` ("a browser" by
 * default, "this device" where the label is about the viewer's own browser).
 */
export function displayDeviceName(label, { fallback = UNNAMED_BROWSER } = {}) {
  const text = typeof label === 'string' ? label.trim() : '';
  if (!text || isMachineDeviceLabel(text)) return fallback;
  return text;
}

/**
 * Human-readable device name. Uses configured `name` when present, otherwise
 * humanizes the kebab-case id ("livingroom-tv" → "Living Room TV"). A hash
 * (made-up browser name, raw browser id) is never shown: it reads "a browser".
 * @param {{id?: string, name?: string}|null} device
 * @param {string} [fallbackId] - id to humanize when device is null/partial
 */
export function deviceName(device, fallbackId) {
  const name = device?.name;
  if (typeof name === 'string' && name.trim() && !isMachineDeviceLabel(name)) return name.trim();
  const id = device?.id ?? fallbackId ?? '';
  if (!id) return 'Unknown device';
  if (isMachineDeviceLabel(String(id)) || /^(browser|ephemeral):/i.test(String(id))) return UNNAMED_BROWSER;
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
  const loc = device?.location ?? device?.room;
  return typeof loc === 'string' ? loc.trim() : '';
}

export default { deviceName, displayDeviceName, deviceIcon, deviceLocation };
