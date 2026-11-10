import { formatKwh } from '../entities/formatEntityState.js';

/** "3 h 20 m", "40 m", "< 1 m" — and a week's worth as whole hours, "136 h". */
function formatDuration(hours) {
  if (hours >= 24) return `${Math.round(hours)} h`;
  const minutes = Math.round(hours * 60);
  if (minutes < 1) return '< 1 m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} m`;
  return m ? `${h} h ${m} m` : `${h} h`;
}

const known = (n) => n != null && Number.isFinite(n);

/**
 * The words at the right of a lane. A field the lane could not read (`null`)
 * is no words at all — never "0 rings" or "0 h" for a sensor with no history.
 */
export function formatLaneTotal(kind, total) {
  const t = total || {};
  if (kind === 'power') return known(t.kwh) ? formatKwh(t.kwh) : '';
  if (kind === 'events') {
    if (!known(t.count)) return '';
    if (t.count === 0) return 'No rings';
    return t.count === 1 ? '1 ring' : `${t.count} rings`;
  }
  if (kind === 'occupancy') {
    if (!known(t.hours)) return '';
    return t.hours > 0 ? formatDuration(t.hours) : 'Empty';
  }
  if (kind === 'screen') {
    if (!known(t.hours)) return '';
    if (t.hours <= 0) return 'Off';
    // A screen lane with no energy meter still says how long it was on.
    return known(t.kwh) ? `${formatDuration(t.hours)} · ${formatKwh(t.kwh)}` : formatDuration(t.hours);
  }
  return '';
}

export default formatLaneTotal;
