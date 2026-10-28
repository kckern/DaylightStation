/**
 * The words a tile shows for an entity's state: "On", "Open", "Motion",
 * "71.4 °F", "Unavailable".
 */

// Binary sensors report on/off; what "on" means depends on the device class.
const BINARY_WORDS = {
  motion: ['Motion', 'Clear'],
  occupancy: ['Occupied', 'Clear'],
  presence: ['Present', 'Away'],
  door: ['Open', 'Closed'],
  window: ['Open', 'Closed'],
  opening: ['Open', 'Closed'],
  garage_door: ['Open', 'Closed'],
  moisture: ['Wet', 'Dry'],
  smoke: ['Smoke', 'Clear'],
  gas: ['Gas', 'Clear'],
  problem: ['Problem', 'OK'],
  safety: ['Unsafe', 'Safe'],
  lock: ['Unlocked', 'Locked'],
  plug: ['Plugged in', 'Unplugged'],
  power: ['Powered', 'No power'],
  running: ['Running', 'Stopped'],
};

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : s);

function formatNumber(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  const digits = abs >= 100 || Number.isInteger(n) ? 0 : abs >= 10 ? 1 : 2;
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

/**
 * @param {{domain: string, state: string|null, stateClass: string, unit?: string|null,
 *   deviceClass?: string|null, attributes?: Object}} entity
 * @returns {string}
 */
export function formatEntityState(entity) {
  const { domain, state, stateClass, unit, deviceClass, attributes = {} } = entity;
  if (stateClass === 'unavailable') return 'Unavailable';
  if (domain === 'binary_sensor') {
    const words = BINARY_WORDS[deviceClass];
    if (words) return state === 'on' ? words[0] : words[1];
    return state === 'on' ? 'On' : 'Off';
  }
  if (domain === 'light' && state === 'on' && Number.isFinite(attributes.brightness)) {
    return `On · ${Math.round((attributes.brightness / 255) * 100)}%`;
  }
  if (domain === 'climate') {
    const current = formatNumber(attributes.current_temperature);
    const mode = capitalize(attributes.hvac_action || state);
    return current ? `${current}° · ${mode}` : mode;
  }
  if (domain === 'media_player' && state === 'playing' && attributes.media_title) {
    return `Playing · ${attributes.media_title}`;
  }
  if (stateClass === 'reading') {
    const n = formatNumber(state);
    if (n != null) return unit ? `${n} ${unit}` : n;
  }
  return capitalize(state);
}

/** "3m ago" style age of the last change, or null. */
export function formatAge(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
