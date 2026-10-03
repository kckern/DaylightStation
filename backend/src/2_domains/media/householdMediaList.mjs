/**
 * Household media list — pure rules for the household's shared memory of
 * what has played: recent (RQ-FIND-11), carry on (RQ-FIND-12, RQ-PLAY-09),
 * favourites (RQ-FIND-14) and removal from the list (RQ-FIND-15).
 *
 * Inputs are plain progress records (`{contentId, namespaceId, playhead,
 * duration, percent, lastPlayed, completedAt, spots, lastDevice}`); no I/O
 * and no clock — callers pass timestamps in.
 *
 * Removal semantics: a removal hides what was played UP TO the moment of
 * removal. Playing the item again afterwards brings it back — "remove from
 * the list" is about the late-night film already played, not a ban.
 *
 * @module domains/media/householdMediaList
 */

import {
  openSpotsOf,
  isSpotOpen,
  isSpotFinished,
  spotPercent,
  spotDeviceKind,
  fleetIdOf,
  hasSpotHistory,
  timestampEpoch,
  compareTimestamps,
} from '#domains/content/services/mediaSpots.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

export const FAVOURITE_KINDS = Object.freeze(['item', 'collection']);

// ── Favourites ────────────────────────────────────────────────────────────

/**
 * @param {Array<Object>} list
 * @param {{id:string, kind?:string, title?:string, thumbnail?:string, type?:string}} entry
 * @param {string} at - timestamp the caller stamps
 * @returns {Array<Object>} new list, newest first
 */
export function addFavourite(list, entry, at) {
  const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
  if (!id) throw new ValidationError('Favourite requires an id', { code: 'MISSING_ID', field: 'id' });
  const kind = entry.kind ?? 'item';
  if (!FAVOURITE_KINDS.includes(kind)) {
    throw new ValidationError(`Favourite kind must be one of ${FAVOURITE_KINDS.join(', ')}`, { code: 'INVALID_KIND', field: 'kind' });
  }
  const record = {
    id,
    kind,
    title: entry.title ?? null,
    thumbnail: entry.thumbnail ?? null,
    type: entry.type ?? null,
    addedAt: at,
  };
  return [record, ...(list || []).filter((f) => f.id !== id)];
}

export function removeFavourite(list, id) {
  return (list || []).filter((f) => f.id !== id);
}

// ── Removal from the household list ───────────────────────────────────────

export function markRemoved(removed, id, at) {
  if (typeof id !== 'string' || !id.trim()) throw new ValidationError('Removal requires an id', { code: 'MISSING_ID', field: 'id' });
  return { ...(removed || {}), [id.trim()]: { removedAt: at } };
}

export function restoreRemoved(removed, id) {
  const next = { ...(removed || {}) };
  delete next[id];
  return next;
}

/**
 * Hidden when removed at or after the item's last play.
 */
export function isHiddenByRemoval(removed, contentId, lastPlayed) {
  const entry = removed?.[contentId];
  if (!entry) return false;
  const removedAt = timestampEpoch(entry.removedAt);
  const played = timestampEpoch(lastPlayed);
  if (!Number.isFinite(played) || !Number.isFinite(removedAt)) return true;
  return removedAt >= played;
}

// ── Projections ───────────────────────────────────────────────────────────

function playedOnOf(deviceId) {
  if (!deviceId) return null;
  return { deviceId, kind: spotDeviceKind(deviceId), screenId: fleetIdOf(deviceId) };
}

function spotView(deviceId, spot) {
  return {
    deviceId,
    kind: spotDeviceKind(deviceId),
    screenId: fleetIdOf(deviceId),
    playhead: Number(spot?.playhead) || 0,
    duration: Number(spot?.duration) || 0,
    percent: spotPercent(spot),
    lastPlayed: spot?.lastPlayed ?? null,
    open: isSpotOpen(spot),
  };
}

function allSpotsOf(record) {
  if (!hasSpotHistory(record)) return [];
  return Object.entries(record.spots || {})
    .map(([deviceId, spot]) => spotView(deviceId, spot))
    .sort((a, b) => compareTimestamps(b.lastPlayed, a.lastPlayed));
}

/** One record per content id — the newest wins when an id sits in two namespaces. */
function latestPerContent(records) {
  const byId = new Map();
  for (const record of records || []) {
    if (!record?.contentId) continue;
    const prev = byId.get(record.contentId);
    if (!prev || compareTimestamps(record.lastPlayed, prev.lastPlayed) > 0) byId.set(record.contentId, record);
  }
  return [...byId.values()];
}

function baseEntry(record) {
  return {
    contentId: record.contentId,
    namespaceId: record.namespaceId ?? null,
    lastPlayed: record.lastPlayed ?? null,
    playhead: Number(record.playhead) || 0,
    duration: Number(record.duration) || 0,
    percent: spotPercent(record),
    finished: isSpotFinished(record),
    completedAt: record.completedAt ?? null,
    playedOn: playedOnOf(record.lastDevice),
  };
}

/**
 * Household recent: everything played on any screen, newest first.
 * Records with no lastPlayed (e.g. only ever marked watched) are not "played".
 *
 * `plays` are play-ledger rows (one per playback start per screen). They
 * label each entry with its start history (`plays`, newest first, up to
 * PLAYS_PER_ENTRY), supply `playedOn` for records that predate per-screen
 * spots, and contribute items the ledger saw but progress never stored.
 */
export const PLAYS_PER_ENTRY = 5;

export function buildHouseholdRecent(records, { removed = {}, limit = 50, plays = [] } = {}) {
  const playsById = new Map();
  for (const row of [...(plays || [])].sort((a, b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0))) {
    if (!row?.contentId || !row.deviceId) continue;
    if (!playsById.has(row.contentId)) playsById.set(row.contentId, []);
    playsById.get(row.contentId).push(row);
  }
  const known = new Set((records || []).map((r) => r?.contentId));
  const ledgerOnly = [...playsById.entries()]
    .filter(([contentId]) => !known.has(contentId))
    .map(([contentId, rows]) => ({ contentId, namespaceId: null, lastPlayed: rows[0].localTime ?? rows[0].startedAt, lastDevice: rows[0].deviceId }));

  return latestPerContent([...(records || []), ...ledgerOnly])
    .filter((r) => Number.isFinite(timestampEpoch(r.lastPlayed)))
    .filter((r) => !isHiddenByRemoval(removed, r.contentId, r.lastPlayed))
    .sort((a, b) => compareTimestamps(b.lastPlayed, a.lastPlayed))
    .slice(0, Math.max(0, limit))
    .map((r) => {
      const rows = playsById.get(r.contentId) || [];
      const entry = { ...baseEntry(r), spots: allSpotsOf(r) };
      if (!entry.playedOn && rows.length) entry.playedOn = playedOnOf(rows[0].deviceId);
      entry.plays = rows.slice(0, PLAYS_PER_ENTRY).map((row) => ({
        ...playedOnOf(row.deviceId),
        startedAt: row.startedAt,
        origin: row.origin ?? null,
      }));
      return entry;
    });
}

/**
 * Carry on: items with at least one open spot (any screen), newest open spot
 * first. Items playing on a screen right now are moved to `nowOn`.
 * @param {Array<Object>} records
 * @param {{removed?:Object, nowPlaying?:Array<{deviceId:string, screenId:string|null, contentId:string, state:string, position?:number}>, limit?:number}} opts
 */
export function buildCarryOn(records, { removed = {}, nowPlaying = [], limit = 20 } = {}) {
  const playing = new Map();
  for (const np of nowPlaying || []) {
    if (!np?.contentId) continue;
    if (!playing.has(np.contentId)) playing.set(np.contentId, []);
    playing.get(np.contentId).push(np);
  }

  const items = [];
  const nowOn = [];
  for (const record of latestPerContent(records)) {
    if (isHiddenByRemoval(removed, record.contentId, record.lastPlayed)) continue;
    const open = openSpotsOf(record);
    if (playing.has(record.contentId)) {
      for (const np of playing.get(record.contentId)) {
        nowOn.push({ ...baseEntry(record), deviceId: np.deviceId, screenId: np.screenId ?? fleetIdOf(np.deviceId), state: np.state, position: np.position ?? null });
      }
      continue;
    }
    if (!open.length) continue;
    items.push({
      ...baseEntry(record),
      reason: 'unfinished',
      spots: open.map((s) => ({ ...s, kind: spotDeviceKind(s.deviceId), screenId: fleetIdOf(s.deviceId), open: true })),
      _sortKey: open[0].lastPlayed ?? record.lastPlayed,
    });
  }
  items.sort((a, b) => compareTimestamps(b._sortKey, a._sortKey));
  return {
    items: items.slice(0, Math.max(0, limit)).map(({ _sortKey, ...rest }) => rest),
    nowOn,
  };
}

/**
 * Recently finished items with no open spot anywhere — the starting points
 * for "next episode" (the application layer decides which are episodes).
 */
export function finishedEpisodeCandidates(records, { removed = {}, limit = 8 } = {}) {
  return latestPerContent(records)
    .filter((r) => Number.isFinite(timestampEpoch(r.lastPlayed)))
    .filter((r) => isSpotFinished(r) && openSpotsOf(r).length === 0)
    .filter((r) => !isHiddenByRemoval(removed, r.contentId, r.lastPlayed))
    .sort((a, b) => compareTimestamps(b.lastPlayed, a.lastPlayed))
    .slice(0, Math.max(0, limit));
}
