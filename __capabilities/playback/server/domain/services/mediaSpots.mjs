/**
 * Per-screen spots — pure policy for where each screen stopped in an item.
 *
 * One progress record per content id keeps its legacy single playhead (every
 * current reader — fitness, piano, school, Player resume — reads that) and,
 * beside it, a `spots` map keyed by stable device id:
 *
 *   spots:
 *     'fleet:livingroom-tv': { playhead, duration, percent, lastPlayed }
 *     'browser:c74fee96a6134c13': { ... }
 *   lastDevice: 'browser:c74fee96a6134c13'
 *
 * Device ids are the `X-Daylight-Device` values minted by
 * `frontend/src/lib/deviceIdentity.js`: `fleet:<devices.yml key>` for a
 * rendered screen, `browser:<token>` for any other browser. The prefix is
 * required. `ephemeral:` ids die with the page, so a spot keyed by one could
 * never be continued and is refused; so is a User-Agent fallback, which is not
 * an identity.
 *
 * One reserved key, `legacy`, holds the single playhead a record had before
 * its first spot-aware write (see seedLegacySpot). No client can write it.
 *
 * Thresholds are the RQ-FIND-12 defaults (requirements NF-DEF):
 *   - unfinished once 5 minutes OR 5% has been played;
 *   - finished "once the credits start" — read as the codebase's existing
 *     completion line, 90% (MediaProgress.isWatched, completedAt in
 *     RecordPlaybackProgress). One rule everywhere, so a spot is never
 *     "finished" here and "in progress" to the Player's resume logic.
 *
 * @module domains/content/services/mediaSpots
 */

export const SPOT_DEFAULTS = Object.freeze({
  unfinishedMinSeconds: 300,
  unfinishedMinPercent: 5,
  finishedPercent: 90,
});

const DEVICE_ID_PATTERN = /^(fleet|browser):[A-Za-z0-9._-]{1,96}$/;

/** Reserved spot key for a pre-spots single playhead. */
export const LEGACY_SPOT_KEY = 'legacy';

/**
 * Accept a device id that can key a spot, or null. The `fleet:` / `browser:`
 * prefix is required — a bare name is not promoted.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeSpotDeviceId(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return DEVICE_ID_PATTERN.test(value) ? value : null;
}

/**
 * @param {string|null} deviceId
 * @returns {'screen'|'browser'|'unknown'}
 */
export function spotDeviceKind(deviceId) {
  if (typeof deviceId !== 'string') return 'unknown';
  if (deviceId.startsWith('fleet:')) return 'screen';
  if (deviceId.startsWith('browser:')) return 'browser';
  return 'unknown';
}

/**
 * The fleet (devices.yml) id of a spot device, or null for a browser.
 * @param {string|null} deviceId
 * @returns {string|null}
 */
export function fleetIdOf(deviceId) {
  return typeof deviceId === 'string' && deviceId.startsWith('fleet:') ? deviceId.slice(6) : null;
}

/**
 * @param {{playhead?:number, duration?:number, percent?:number|null}} spot
 * @returns {number} 0-100
 */
export function spotPercent(spot) {
  const playhead = Number(spot?.playhead) || 0;
  const duration = Number(spot?.duration) || 0;
  if (duration > 0) return Math.round((playhead / duration) * 100);
  const stored = Number(spot?.percent);
  return Number.isFinite(stored) ? stored : 0;
}

export function isSpotFinished(spot, policy = SPOT_DEFAULTS) {
  return spotPercent(spot) >= policy.finishedPercent;
}

export function isSpotOpen(spot, policy = SPOT_DEFAULTS) {
  if (!spot || isSpotFinished(spot, policy)) return false;
  const playhead = Number(spot.playhead) || 0;
  return playhead >= policy.unfinishedMinSeconds || spotPercent(spot) >= policy.unfinishedMinPercent;
}

/**
 * Return a new spots map with `deviceId`'s spot set. Never mutates.
 * @param {Object|null|undefined} spots
 * @param {string} deviceId
 * @param {{playhead:number, duration:number, at:string}} sample
 */
export function recordSpot(spots, deviceId, { playhead, duration, at }) {
  const next = { ...(spots || {}) };
  next[deviceId] = {
    playhead,
    duration,
    percent: spotPercent({ playhead, duration }),
    lastPlayed: at,
  };
  return next;
}

/**
 * Whether a record's spots speak for it: a NON-EMPTY spots map. A record whose
 * spots were cleared (marked watched/unwatched) is judged by its single
 * playhead again, so later playback without a device id still shows.
 */
export function hasSpotHistory(record) {
  return Boolean(record?.spots && Object.keys(record.spots).length > 0);
}

/**
 * On the first spot-aware write to a record without spot history, its open
 * single playhead becomes a `legacy` spot so the place someone stopped before
 * spots existed is not lost. Returns the spots to start from.
 */
export function seedLegacySpot(record, policy = SPOT_DEFAULTS) {
  if (!record || hasSpotHistory(record) || !isSpotOpen(record, policy)) return { ...(record?.spots || {}) };
  return {
    [LEGACY_SPOT_KEY]: {
      playhead: Number(record.playhead) || 0,
      duration: Number(record.duration) || 0,
      percent: spotPercent(record),
      lastPlayed: record.lastPlayed ?? null,
    },
  };
}

/**
 * Drop the legacy spot once any screen has played past it — that viewing has
 * evidently been carried on.
 */
export function retireLegacySpot(spots, playhead) {
  const legacy = spots?.[LEGACY_SPOT_KEY];
  if (!legacy || !(Number(playhead) >= (Number(legacy.playhead) || 0))) return spots;
  const next = { ...spots };
  delete next[LEGACY_SPOT_KEY];
  return next;
}

/**
 * Open (unfinished) spots of a progress record, newest first.
 * A legacy record without spot history contributes its single playhead as one
 * anonymous spot (`deviceId: null`) so carry-on keeps working across the
 * change.
 * @param {Object} record
 * @returns {Array<{deviceId:string|null, playhead:number, duration:number, percent:number, lastPlayed:string|null}>}
 */
export function openSpotsOf(record, policy = SPOT_DEFAULTS) {
  if (!record) return [];
  if (!hasSpotHistory(record)) {
    const legacy = {
      deviceId: null,
      playhead: Number(record.playhead) || 0,
      duration: Number(record.duration) || 0,
      percent: spotPercent(record),
      lastPlayed: record.lastPlayed ?? null,
    };
    return isSpotOpen(legacy, policy) ? [legacy] : [];
  }
  return Object.entries(record.spots || {})
    .map(([deviceId, spot]) => ({
      deviceId,
      playhead: Number(spot?.playhead) || 0,
      duration: Number(spot?.duration) || 0,
      percent: spotPercent(spot),
      lastPlayed: spot?.lastPlayed ?? null,
    }))
    .filter((spot) => isSpotOpen(spot, policy))
    .sort((a, b) => compareTimestamps(b.lastPlayed, a.lastPlayed));
}

/**
 * Epoch ms for the timestamp shapes progress records carry: the local
 * `YYYY-MM-DD HH:mm:ss` written by play/log, and ISO strings written by sync.
 * @param {string|null|undefined} value
 * @returns {number} NaN when absent/unparseable
 */
export function timestampEpoch(value) {
  if (typeof value !== 'string' || !value) return NaN;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? value.replace(' ', 'T') : value;
  return Date.parse(normalized);
}

/** Comparator helper: missing timestamps sort last. */
export function compareTimestamps(a, b) {
  const ea = timestampEpoch(a);
  const eb = timestampEpoch(b);
  const va = Number.isFinite(ea) ? ea : -Infinity;
  const vb = Number.isFinite(eb) ? eb : -Infinity;
  if (va === vb) return 0;
  return va < vb ? -1 : 1;
}

/**
 * Fold a merged duplicate screen's spot onto the screen it was merged into.
 * Newest spot wins the target key; nothing is dropped — when both screens
 * hold a spot, the older one stays under the duplicate's key (the registry
 * lists that id as an alias), so an unmerge can swap them back.
 *
 * @param {{spots?:Object, lastDevice?:string|null}} record
 * @param {string} fromId - the duplicate (merged away)
 * @param {string} intoId - the screen it was merged into
 * @returns {{spots:Object, lastDevice:string|null, move:'moved'|'swapped'}|null} null = nothing to fold
 */
export function foldSpot(record, fromId, intoId) {
  const spots = record?.spots || {};
  const mine = spots[fromId];
  if (!mine) return null;
  const theirs = spots[intoId];
  if (theirs && compareTimestamps(mine.lastPlayed, theirs.lastPlayed) <= 0) return null;
  const next = { ...spots, [intoId]: mine };
  if (theirs) next[fromId] = theirs;
  else delete next[fromId];
  const lastDevice = record?.lastDevice === fromId ? intoId : (record?.lastDevice ?? null);
  return { spots: next, lastDevice, move: theirs ? 'swapped' : 'moved' };
}

/**
 * Undo foldSpot after an unmerge. Only when the target's spot is still the
 * one that was folded (`lastPlayed` unchanged) — a spot the target has played
 * on since belongs to the target now and is left alone.
 *
 * @param {{spots?:Object, lastDevice?:string|null}} record
 * @param {string} fromId
 * @param {string} intoId
 * @param {{move:'moved'|'swapped', lastPlayed:string, lastDevice?:string|null}} fold - what foldSpot did
 * @returns {{spots:Object, lastDevice:string|null}|null}
 */
export function unfoldSpot(record, fromId, intoId, fold) {
  const spots = record?.spots || {};
  const folded = spots[intoId];
  if (!folded || folded.lastPlayed !== fold?.lastPlayed) return null;
  const next = { ...spots, [fromId]: folded };
  if (fold.move === 'swapped' && spots[fromId]) next[intoId] = spots[fromId];
  else delete next[intoId];
  const lastDevice = fold.lastDevice !== undefined && record?.lastDevice === intoId ? fold.lastDevice : (record?.lastDevice ?? null);
  return { spots: next, lastDevice };
}
