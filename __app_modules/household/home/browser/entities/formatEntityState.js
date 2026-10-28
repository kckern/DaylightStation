/**
 * The words a row shows for an entity's state: "On", "Open", "Motion",
 * "71.4 °F", "Unavailable". One short phrase, no decoration.
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

/** "1,235", "71.5", "0.25" — digits scaled to the size of the number; null for a non-number. */
export function formatNumber(raw) {
  // Number('') is 0 — an empty reading is not a zero.
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  const digits = abs >= 100 || Number.isInteger(n) ? 0 : abs >= 10 ? 1 : 2;
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

/** "505 W" below a kilowatt, "1.2 kW" above. */
export function formatWatts(watts) {
  if (!Number.isFinite(watts)) return null;
  if (Math.abs(watts) >= 1000) return `${(watts / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} kW`;
  return `${Math.round(watts).toLocaleString()} W`;
}

/** "40.0 kWh", "850 kWh". */
export function formatKwh(kwh) {
  if (!Number.isFinite(kwh)) return null;
  const digits = Math.abs(kwh) >= 100 ? 0 : 1;
  return `${kwh.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })} kWh`;
}

/** "69°" — a temperature as a glance reads it. */
export function formatDegrees(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? `${Math.round(n)}°` : null;
}

/**
 * @param {{domain: string, state: string|null, stateClass: string, unit?: string|null,
 *   deviceClass?: string|null, detail?: Object}} entity
 * @returns {string}
 */
export function formatEntityState(entity) {
  const { domain, state, stateClass, unit, deviceClass, detail = {} } = entity;
  if (stateClass === 'unavailable') return 'Unavailable';
  if (domain === 'binary_sensor') {
    const words = BINARY_WORDS[deviceClass];
    if (words) return state === 'on' ? words[0] : words[1];
    return state === 'on' ? 'On' : 'Off';
  }
  // A lit lamp's brightness says "on" by itself.
  if (domain === 'light' && state === 'on' && Number.isFinite(detail.brightnessPct)) {
    return `${detail.brightnessPct}%`;
  }
  if (domain === 'climate') {
    const current = formatNumber(detail.currentTemperature);
    const mode = (detail.hvacAction || state || '').replace(/_/g, ' ');
    return current ? `${current}°, ${mode}` : capitalize(mode);
  }
  if (domain === 'media_player' && state === 'playing' && detail.mediaTitle) {
    return `Playing: ${detail.mediaTitle}`;
  }
  if (stateClass === 'reading') {
    const n = formatNumber(state);
    if (n != null) return unit ? `${n} ${unit}` : n;
  }
  return capitalize(state);
}

// Some integrations name a contact sensor after its state ("Open"); say where it is instead.
const GENERIC_OPENING_NAMES = /^(open|closed|contact|door|window|opening|on|off)$/i;

/** What an opening is, in a word: "door", "window", "garage door", "blinds". */
export function openingWord(entity) {
  if (entity.domain === 'cover') {
    if (entity.deviceClass === 'garage') return 'garage door';
    if (entity.deviceClass === 'shade' || entity.deviceClass === 'blind') return 'blinds';
    return 'cover';
  }
  if (entity.domain === 'lock') return 'lock';
  return entity.deviceClass === 'window' ? 'window' : 'door';
}

/** The entity's name, unless the platform named it after its state — then "Office door". */
export function displayName(entity) {
  if (entity.type !== 'openings' || !GENERIC_OPENING_NAMES.test((entity.name || '').trim())) return entity.name;
  const what = openingWord(entity);
  return entity.room ? `${entity.room.name} ${what}` : `${what.charAt(0).toUpperCase()}${what.slice(1)}`;
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

/** "8:29 pm" today, "yesterday 8:29 pm", or "Oct 20" — when something happened, as a person says it. */
export function formatSince(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const then = new Date(t);
  const today = new Date(now);
  const time = then.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  const sameDay = then.toDateString() === today.toDateString();
  if (sameDay) return time;
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (then.toDateString() === yesterday.toDateString()) return `yesterday ${time}`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
