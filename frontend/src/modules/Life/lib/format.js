// frontend/src/modules/Life/lib/format.js
// Parse a 'YYYY-MM-DD' as a LOCAL calendar date (not UTC midnight, which would
// shift the day backward in western timezones).
function parseLocal(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function formatDate(iso, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  const dt = parseLocal(iso);
  return dt ? dt.toLocaleDateString(undefined, opts) : '';
}

export function formatDateRange(startIso, endIso) {
  const start = parseLocal(startIso);
  const end = parseLocal(endIso);
  if (!start || !end) return formatDate(startIso) || formatDate(endIso) || '';
  const sameYear = start.getFullYear() === end.getFullYear();
  const left = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const right = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return sameYear ? `${left} – ${right}` : `${formatDate(startIso)} – ${formatDate(endIso)}`;
}

export function formatPeriodLabel({ alias, level, periodId } = {}) {
  const name = alias || (level ? level.charAt(0).toUpperCase() + level.slice(1) : '');
  const when = /^\d{4}-\d{2}-\d{2}/.test(periodId || '')
    ? formatDate(periodId, { month: 'short', day: 'numeric' })
    : (periodId || '');
  return when ? `${name} · ${when}` : name;
}

export function humanize(id) {
  if (!id) return '';
  const s = String(id).replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
