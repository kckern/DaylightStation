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
const MAX_ORIGIN_ID = 96;

function bounded(value, max) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

/**
 * How a playback started, as stored on a ledger row.
 *
 *   string                    legacy free text (≤ 64 chars), kept as given
 *   { kind: 'device', id, name }   a person on another screen sent it
 *   { kind: 'routine', id, name }  a routine started it (HA automation, button)
 *
 * A device origin needs `id`; a routine needs `id` or `name`. Anything else
 * (unknown kind, missing identity) is dropped to null rather than stored half.
 * @param {unknown} origin
 * @returns {string|{kind:'device'|'routine', id:string|null, name:string|null}|null}
 */
export function normalizeLedgerOrigin(origin) {
  if (typeof origin === 'string') return bounded(origin, MAX_ORIGIN);
  if (!origin || typeof origin !== 'object') return null;
  const id = bounded(origin.id, MAX_ORIGIN_ID);
  const name = bounded(origin.name, MAX_ORIGIN);
  if (origin.kind === 'device') return id ? { kind: 'device', id, name } : null;
  if (origin.kind === 'routine') return id || name ? { kind: 'routine', id, name } : null;
  return null;
}

function qualify(id, contentId) {
  if (id === undefined || id === null || id === '') return null;
  const value = String(id);
  if (value.includes(':')) return value;
  const source = String(contentId).split(':')[0];
  return source ? `${source}:${value}` : value;
}

/**
 * @param {{deviceId:string, contentId:string, startedAt:string, localTime:string, metadata?:Object, origin?:string|Object|null}} input
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
    origin: normalizeLedgerOrigin(origin),
  };
}

/**
 * Filter by device (one id, or several — a screen plus the duplicates merged
 * into it) and time window (ISO or epoch-parseable bounds, inclusive),
 * newest first, limited.
 */
export function selectPlays(rows, { deviceId = null, from = null, to = null, limit = null } = {}) {
  const fromMs = from ? Date.parse(from) : -Infinity;
  const toMs = to ? Date.parse(to) : Infinity;
  const devices = Array.isArray(deviceId) ? new Set(deviceId) : (deviceId ? new Set([deviceId]) : null);
  const out = (rows || [])
    .filter((r) => r && (!devices || devices.has(r.deviceId)))
    .filter((r) => {
      const t = Date.parse(r.startedAt);
      return Number.isFinite(t) ? t >= fromMs && t <= toMs : !from && !to;
    })
    .sort((a, b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0));
  return Number.isFinite(limit) && limit > 0 ? out.slice(0, limit) : out;
}
