/**
 * Per-screen play ledger — pure row shape and query rules.
 *
 * One row per playback START on a screen (see PlayLedgerRecorder): which
 * device, which item, when, and how it started when that is known. It is the
 * household's record of WHERE things played; progress records say how far.
 *
 * Backs household recent's "played on" history today, and is the intended
 * source for "Played earlier" (RQ-FIND-17), "how it started" (RQ-HOUSE-07)
 * and time-of-day suggestions (RQ-FIND-16).
 *
 * @module domains/media/playLedger
 */

export const PLAY_LEDGER_RETENTION_DAYS = 90;
const MAX_ORIGIN = 64;

function qualify(id, contentId) {
  if (id === undefined || id === null || id === '') return null;
  const value = String(id);
  if (value.includes(':')) return value;
  const source = String(contentId).split(':')[0];
  return source ? `${source}:${value}` : value;
}

/**
 * @param {{deviceId:string, contentId:string, startedAt:string, localTime:string, metadata?:Object, origin?:string|null}} input
 */
export function buildPlayLedgerRow({ deviceId, contentId, startedAt, localTime, metadata = null, origin = null }) {
  const meta = metadata || {};
  return {
    startedAt,
    localTime,
    deviceId,
    contentId,
    title: meta.title ?? null,
    kind: meta.type ?? null,
    parentId: qualify(meta.parentId ?? meta.albumId, contentId),
    grandparentId: qualify(meta.grandparentId ?? meta.artistId, contentId),
    origin: typeof origin === 'string' && origin.trim() ? origin.trim().slice(0, MAX_ORIGIN) : null,
  };
}

/**
 * Filter by device and time window (ISO or epoch-parseable bounds, inclusive),
 * newest first, limited.
 */
export function selectPlays(rows, { deviceId = null, from = null, to = null, limit = null } = {}) {
  const fromMs = from ? Date.parse(from) : -Infinity;
  const toMs = to ? Date.parse(to) : Infinity;
  const out = (rows || [])
    .filter((r) => r && (!deviceId || r.deviceId === deviceId))
    .filter((r) => {
      const t = Date.parse(r.startedAt);
      return Number.isFinite(t) ? t >= fromMs && t <= toMs : !from && !to;
    })
    .sort((a, b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0));
  return Number.isFinite(limit) && limit > 0 ? out.slice(0, limit) : out;
}
