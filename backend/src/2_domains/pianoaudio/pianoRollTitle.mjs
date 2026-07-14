/**
 * pianoRollTitle — derive a human date/time title from a piano recording's
 * mirror-relative path. Both layouts carry a timestamp:
 *   jamcorder/YYYY/YYYY-MM/YYYY-MM-DD HH.MM.SS.mid
 *   {user}/YYYY-MM-DD/HH.MM.SS.mid
 *
 * Layer: DOMAIN (2_domains/pianoaudio). Pure — string math only.
 * @module domains/pianoaudio/pianoRollTitle
 */

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// YYYY-MM-DD then (space or slash) then HH.MM.SS (dots or colons).
const RE = /(\d{4})-(\d{2})-(\d{2})[ /](\d{2})[.:](\d{2})[.:](\d{2})/;

/**
 * @param {string} relPath - path relative to history/piano (e.g. a jamcorder or user path)
 * @returns {string} e.g. "Thu Jul 9, 2026 · 7:22 AM" — or '' if no timestamp found
 */
export function pianoRollTitleFromRel(relPath) {
  const m = RE.exec(String(relPath || ''));
  if (!m) return '';
  const [, y, mo, d, hh, mm] = m.map(Number);
  // Day-of-week via a fixed reference (pure — no `new Date()` needed for the label,
  // but Date math here is deterministic given the numbers).
  const dow = DOW[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  const h12 = ((hh + 11) % 12) + 1;
  const ampm = hh < 12 ? 'AM' : 'PM';
  return `${dow} ${MON[mo - 1]} ${d}, ${y} · ${h12}:${String(mm).padStart(2, '0')} ${ampm}`;
}

export default { pianoRollTitleFromRel };
