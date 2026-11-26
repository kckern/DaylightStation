/**
 * A stored timestamp as an instant (epoch ms), whatever shape it was stored in:
 *   - with a zone (`…Z`, `…+01:00`, `…-08:00`): that instant;
 *   - bare (`YYYY-MM-DD HH:mm:ss` or `YYYY-MM-DDTHH:mm:ss`): a wall-clock time in the
 *     household zone. In the hour a fall-back repeats, the earlier of the two instants.
 * Null when it is not a timestamp. Pure (Intl only).
 *
 * Progress records hold all three shapes (play/log writes household-local bare
 * stamps; the media-server sync wrote UTC ISO), so comparing them as text is wrong by
 * the zone offset; compare these instants instead.
 *
 * @module playback/domain/stampEpoch
 */

const ZONED = /(Z|[+-]\d{2}:?\d{2})$/i;
const BARE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

/** The zone's offset from UTC at an instant, in minutes (west negative). */
function offsetMinutes(epochMs, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(epochMs)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / 60000);
}

/**
 * @param {string|number|Date|null} stamp
 * @param {string} [timeZone] IANA zone for bare stamps
 * @returns {number|null}
 */
export function stampEpoch(stamp, timeZone = 'UTC') {
  if (stamp === null || stamp === undefined || stamp === '') return null;
  if (stamp instanceof Date) return Number.isFinite(stamp.getTime()) ? stamp.getTime() : null;
  if (typeof stamp === 'number') return Number.isFinite(stamp) ? stamp : null;
  const text = String(stamp).trim();
  if (ZONED.test(text)) {
    const ms = Date.parse(text.replace(' ', 'T'));
    return Number.isFinite(ms) ? ms : null;
  }
  const m = BARE.exec(text);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0), +((m[7] ?? '0').padEnd(3, '0')));
  // The instant whose local wall clock reads `wall`: try the offsets in force a day
  // either side; of the candidates that read back right, the earliest.
  const candidates = new Set([offsetMinutes(wall - 86_400_000, timeZone), offsetMinutes(wall, timeZone), offsetMinutes(wall + 86_400_000, timeZone)]);
  const fits = [];
  for (const off of candidates) {
    const at = wall - off * 60000;
    if (offsetMinutes(at, timeZone) === off) fits.push(at);
  }
  if (fits.length) return Math.min(...fits);
  // A spring-forward gap (the wall time never happened): the instant after the gap.
  return wall - offsetMinutes(wall, timeZone) * 60000;
}

export default stampEpoch;
