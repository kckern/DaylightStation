// frontend/src/modules/Auto/format.js
//
// Unit conversion and display formatting for the Auto app.
//
// The whole system stores KILOMETRES and LITRES — the device reports km, the
// history files are km, the domain is km. This module is the ONLY place that
// converts, and it converts on the way out to the screen and on the way in from
// a form. Nothing downstream of a submit handler and nothing upstream of a
// render should be dealing in miles.
//
// The reason for the discipline: mixed units in a persistence layer is the kind
// of bug that stays invisible until an odometer figure is quietly 1.6x wrong.

export const KM_PER_MILE = 1.609344;
export const LITRES_PER_GALLON = 3.785411784;

export const kmToMiles = (km) => (Number.isFinite(km) ? km / KM_PER_MILE : null);
export const milesToKm = (mi) => (Number.isFinite(mi) ? mi * KM_PER_MILE : null);
export const litresToGallons = (l) => (Number.isFinite(l) ? l / LITRES_PER_GALLON : null);
export const gallonsToLitres = (g) => (Number.isFinite(g) ? g * LITRES_PER_GALLON : null);

/**
 * A distance, in miles.
 *
 * Sub-mile distances keep a decimal because the difference between "0 mi" and
 * "0.3 mi" is the difference between the car not moving and a trip to the
 * corner. Above ten miles the decimal is noise and is dropped.
 */
export function formatDistance(km, { unit = true } = {}) {
  const mi = kmToMiles(km);
  if (mi === null) return unit ? '— mi' : '—';
  const text = mi < 10 ? mi.toFixed(1) : Math.round(mi).toLocaleString();
  return unit ? `${text} mi` : text;
}

export function formatSpeed(kph) {
  const mph = kmToMiles(kph);
  return mph === null ? '—' : `${Math.round(mph)} mph`;
}

export function formatVolume(litres) {
  const gal = litresToGallons(litres);
  return gal === null ? '—' : `${gal.toFixed(1)} gal`;
}

export function formatMoney(amount) {
  if (!Number.isFinite(amount)) return '—';
  return amount.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

/** `1h 24m`, `18m`, `—`. Seconds are never shown; nobody cares. */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds / 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

/**
 * A date for a timeline heading: `Today`, `Yesterday`, `Tue 11 Aug`.
 *
 * Relative labels only reach back two days. Beyond that "5 days ago" forces the
 * reader to do arithmetic to place an event, which a date does for them.
 */
export function formatDay(iso, now = new Date()) {
  if (!iso) return 'Date unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Date unknown';

  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';

  return date.toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

export function formatTime(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * How an odometer figure should be labelled, given where it came from.
 *
 * Every mileage number in the UI is required to carry this. A GPS estimate
 * rendered as though someone read it off the dash is the single most damaging
 * mistake this app can make, because downstream arithmetic then anchors to it.
 */
export function describeOdometerSource(source, confidence) {
  if (confidence === 'unknown') return 'No reading yet — log a fill-up with the dash odometer';
  if (source === 'dash') return 'From your last dash reading';
  if (source === 'pid_31') {
    return confidence === 'degraded'
      ? 'Estimated from the car — has gaps where codes were cleared'
      : 'Estimated from the car’s own distance counter';
  }
  if (source === 'speed_integration') return 'Estimated from recorded speed';
  if (source === 'gps') return 'Estimated from GPS — runs low';
  return 'Estimated';
}
