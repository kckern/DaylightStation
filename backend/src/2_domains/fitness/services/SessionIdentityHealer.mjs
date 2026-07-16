/**
 * SessionIdentityHealer — pure heal-planner over the ON-DISK saved-session
 * representation.
 *
 * Mirrors the effort-based rules of the frontend's
 * `frontend/src/hooks/fitness/sessionBackfill.js` (`runSessionBackfill`'s
 * effort-absorb + known-user cross-device-merge passes), but reads the
 * on-disk shape instead of the in-memory one:
 *
 *   - Participant series keys are FLAT `<id>:hr | :zone | :coins | :beats`
 *     (not `user:<id>:heart_rate` etc.). Equipment/global keys are prefixed
 *     `device:`, `vib:`, `bike:`, `global:` and must be excluded from
 *     occupant discovery.
 *   - Series values are RLE-encoded JSON strings (or already-decoded plain
 *     arrays) — decoded via `TimelineService.decodeSeries`.
 *   - `<id>:zone` values are single letters `c`/`a`/`w`/`h` on disk (the
 *     in-memory representation uses full words `cool`/`active`/`warm`/`hot`;
 *     both forms are accepted here for robustness).
 *   - `entities` carries `{ deviceId, profileId, startTime, endTime, status }`.
 *
 * This module has NO side effects — it only computes a plan. A caller (a
 * later CLI task) is responsible for applying `transfers`/`merges` to the
 * actual timeline series and participant list.
 */

import { decodeSeries } from '#domains/fitness/services/TimelineService.mjs';

const ACTIVE_ZONE_VALUES = new Set(['active', 'warm', 'hot', 'a', 'w', 'h']);

const RESERVED_KEY_RE = /^(?!device:|vib:|bike:|global:)(.+):hr$/;

export const DEFAULT_CFG = { maxCoins: 1, maxActiveZoneSeconds: 5, maxHrSamples: 3 };

/**
 * Conservative detector for synthetic / "Pikachu" occupant IDs (same rule as
 * the frontend's `isPikachuId` + `guest_` extension, combined into one
 * predicate here since the backend healer only needs the "is this a known
 * configured user" question).
 *
 * @param {string} id
 * @returns {boolean}
 */
export function isKnownUserId(id) {
  if (typeof id !== 'string' || !id) return false;
  if (id.startsWith('guest-')) return false; // unidentified synthetic guest
  if (id.startsWith('#')) return false;       // legacy synthetic form
  if (id.startsWith('guest_')) return false;  // device-keyed explicit generic guest
  return true;
}

/**
 * Discover occupant ids from the raw (pre-decode) series key set: any
 * `<id>:hr` key not prefixed with a reserved equipment/global namespace.
 *
 * @param {Object} series - raw (possibly RLE-encoded) timeline.series map
 * @returns {Set<string>}
 */
export function discoverOccupantIds(series) {
  const ids = new Set();
  if (!series || typeof series !== 'object') return ids;
  for (const key of Object.keys(series)) {
    const m = RESERVED_KEY_RE.exec(key);
    if (m) ids.add(m[1]);
  }
  return ids;
}

/**
 * Effort accessor for one occupant against an already-decoded series map.
 *
 * @param {Object} decoded - output of decodeSeries(timeline.series)
 * @param {string} id
 * @param {number} intervalSeconds
 * @returns {{ coins: number, activeWarmZoneSeconds: number, hrSampleCount: number }}
 */
export function occupantEffort(decoded, id, intervalSeconds = 5) {
  const s = decoded && typeof decoded === 'object' ? decoded : {};
  const hr = Array.isArray(s[`${id}:hr`]) ? s[`${id}:hr`] : [];
  const zone = Array.isArray(s[`${id}:zone`]) ? s[`${id}:zone`] : [];
  const coins = Array.isArray(s[`${id}:coins`]) ? s[`${id}:coins`] : [];

  const hrSampleCount = hr.filter((v) => Number.isFinite(v) && v > 0).length;
  const activeWarmZoneSeconds = zone.filter((z) => ACTIVE_ZONE_VALUES.has(z)).length
    * (Number.isFinite(intervalSeconds) ? intervalSeconds : 5);

  let last = 0;
  for (let i = coins.length - 1; i >= 0; i--) {
    if (coins[i] != null) { last = coins[i]; break; }
  }
  return { coins: last, activeWarmZoneSeconds, hrSampleCount };
}

/**
 * Is this occupant's measured effort below the noise floor?
 *
 * @param {{coins:number, activeWarmZoneSeconds:number, hrSampleCount:number}} effort
 * @param {{maxCoins:number, maxActiveZoneSeconds:number, maxHrSamples:number}} cfg
 * @returns {boolean}
 */
export function isInsignificant(effort, cfg = DEFAULT_CFG) {
  if (!effort) return true;
  return effort.coins <= cfg.maxCoins
    && effort.activeWarmZoneSeconds <= cfg.maxActiveZoneSeconds
    && effort.hrSampleCount < cfg.maxHrSamples;
}

/**
 * Build per-device segment lists from the on-disk `entities` array.
 * Segments per device are sorted by startTime ascending.
 *
 * @param {Array<Object>} entities
 * @returns {Map<string, Array<Object>>}
 */
function buildSegmentsPerDevice(entities) {
  const perDevice = new Map();
  if (!Array.isArray(entities)) return perDevice;

  for (const e of entities) {
    if (!e || typeof e !== 'object') continue;
    const deviceId = e.deviceId != null ? String(e.deviceId) : null;
    const occupantId = e.profileId != null ? String(e.profileId) : null;
    if (!deviceId || !occupantId) continue;

    const startTime = Number.isFinite(e.startTime) ? e.startTime : 0;
    const seg = {
      occupantId,
      deviceId,
      startTime,
      endTime: Number.isFinite(e.endTime) ? e.endTime : null,
      status: e.status || 'active',
      seriesOnly: false,
      absorbed: false,
      absorbedInto: null,
      effort: null
    };

    if (!perDevice.has(deviceId)) perDevice.set(deviceId, []);
    perDevice.get(deviceId).push(seg);
  }

  for (const arr of perDevice.values()) {
    arr.sort((a, b) => a.startTime - b.startTime);
  }
  return perDevice;
}

/**
 * Extend `perDevice` with series-only occupants (a `<id>:hr` key with no
 * backing entity). Attributed via successor-fallback: single device → that
 * device; multiple devices → the one whose first segment starts earliest;
 * zero devices → occupant is unattributable and skipped.
 *
 * @param {Map<string, Array<Object>>} perDevice
 * @param {Object} rawSeries - pre-decode timeline.series (for occupant discovery)
 * @param {Object} decoded - decodeSeries(rawSeries) (for effort computation)
 * @param {number} intervalSeconds
 */
function attachSeriesOnlyOccupants(perDevice, rawSeries, decoded, intervalSeconds) {
  const entityOccupants = new Set();
  for (const segs of perDevice.values()) {
    for (const seg of segs) entityOccupants.add(seg.occupantId);
  }

  const seriesOccupantIds = discoverOccupantIds(rawSeries);
  const deviceIds = [...perDevice.keys()];

  for (const occ of seriesOccupantIds) {
    if (entityOccupants.has(occ)) continue;

    const deviceId = deviceIds.length === 1
      ? deviceIds[0]
      : (deviceIds.length
        ? deviceIds.slice().sort((a, b) => {
          const sa = perDevice.get(a)[0]?.startTime ?? Infinity;
          const sb = perDevice.get(b)[0]?.startTime ?? Infinity;
          return sa - sb;
        })[0]
        : null);

    if (!deviceId) continue; // no devices at all — unattributable, skip

    const seg = {
      occupantId: occ,
      deviceId,
      startTime: -1,
      endTime: -1,
      status: 'series-only',
      seriesOnly: true,
      absorbed: false,
      absorbedInto: null,
      effort: occupantEffort(decoded, occ, intervalSeconds)
    };
    perDevice.get(deviceId).unshift(seg); // series-only ghost precedes the honored occupant
  }
}

/**
 * Insignificant-segment absorption: a non-absorbed, insignificant-effort
 * segment folds forward into its device successor (first later segment with
 * a different occupant); if none, backward into the nearest prior
 * non-absorbed segment with a different occupant.
 *
 * @param {Map<string, Array<Object>>} perDevice
 * @param {Object} cfg
 * @returns {Array<{from:string, to:string, reason:string}>}
 */
function absorbInsignificantSegments(perDevice, cfg) {
  const transfers = [];

  for (const segments of perDevice.values()) {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.absorbed) continue;
      if (!isInsignificant(seg.effort, cfg)) continue;

      const next = segments.slice(i + 1).find((s) => s.occupantId !== seg.occupantId);
      if (next) {
        transfers.push({ from: seg.occupantId, to: next.occupantId, reason: 'insignificant-forward' });
        seg.absorbed = true;
        seg.absorbedInto = next.occupantId;
        continue;
      }

      const prior = segments.slice(0, i).reverse()
        .find((s) => !s.absorbed && s.occupantId !== seg.occupantId);
      if (prior) {
        transfers.push({ from: seg.occupantId, to: prior.occupantId, reason: 'insignificant-backward' });
        seg.absorbed = true;
        seg.absorbedInto = prior.occupantId;
      }
      // else: lone insignificant segment with no absorb target — left as-is.
    }
  }

  return transfers;
}

/**
 * Cross-device merge for known (non-guest) users recorded under alias ids —
 * e.g. a strap-swap that split one real person across two device entries.
 *
 * @param {Map<string, Array<Object>>} perDevice
 * @param {Object} knownUserAliases - map of rawId -> canonicalId
 * @returns {Array<{from:string, to:string, reason:string}>}
 */
function mergeKnownUserDevices(perDevice, knownUserAliases) {
  const canonical = (id) => knownUserAliases[id] || id;
  const rawByCanonical = new Map();

  for (const segments of perDevice.values()) {
    for (const seg of segments) {
      if (seg.absorbed) continue;
      if (!isKnownUserId(seg.occupantId)) continue;
      const c = canonical(seg.occupantId);
      if (!rawByCanonical.has(c)) rawByCanonical.set(c, new Set());
      rawByCanonical.get(c).add(seg.occupantId);
    }
  }

  const merges = [];
  for (const [c, rawIds] of rawByCanonical.entries()) {
    for (const raw of rawIds) {
      if (raw === c) continue;
      merges.push({ from: raw, to: c, reason: 'known-user-device-swap' });
    }
  }
  return merges;
}

/**
 * Plan the identity-reconciliation heal for an on-disk saved fitness
 * session. Pure function — returns a plan, applies nothing.
 *
 * @param {Object} sessionYamlObj - decoded session YAML object
 *   ({ entities, timeline: { interval_seconds, series } })
 * @param {Object} [cfg] - overrides for DEFAULT_CFG, plus optional
 *   `known_user_aliases` / `knownUserAliases` map (rawId -> canonicalId).
 *   Falls back to `sessionYamlObj.known_user_aliases` if not supplied.
 * @returns {{
 *   removedOccupants: string[],
 *   transfers: Array<{from:string, to:string, reason:string}>,
 *   merges: Array<{from:string, to:string, reason:string}>,
 *   needsHeal: boolean
 * }}
 */
export function planHeal(sessionYamlObj, cfg = {}) {
  const mergedCfg = { ...DEFAULT_CFG, ...cfg };
  const knownUserAliases = cfg.knownUserAliases
    || cfg.known_user_aliases
    || sessionYamlObj?.known_user_aliases
    || {};

  const timeline = sessionYamlObj?.timeline || {};
  const intervalSeconds = Number.isFinite(timeline.interval_seconds) ? timeline.interval_seconds : 5;
  const rawSeries = timeline.series || {};
  const decoded = decodeSeries(rawSeries);

  const perDevice = buildSegmentsPerDevice(sessionYamlObj?.entities);

  for (const segments of perDevice.values()) {
    for (const seg of segments) {
      seg.effort = occupantEffort(decoded, seg.occupantId, intervalSeconds);
    }
  }

  attachSeriesOnlyOccupants(perDevice, rawSeries, decoded, intervalSeconds);

  const transfers = absorbInsignificantSegments(perDevice, mergedCfg);

  const allOccupants = new Set();
  const kept = new Set();
  for (const segments of perDevice.values()) {
    for (const seg of segments) {
      allOccupants.add(seg.occupantId);
      if (!seg.absorbed) kept.add(seg.occupantId);
    }
  }

  const merges = mergeKnownUserDevices(perDevice, knownUserAliases);
  for (const m of merges) kept.delete(m.from);

  const removed = new Set([...allOccupants].filter((id) => !kept.has(id)));
  for (const m of merges) removed.add(m.from);

  return {
    removedOccupants: [...removed].sort(),
    transfers,
    merges,
    needsHeal: removed.size > 0 || merges.length > 0
  };
}

export default { planHeal, isKnownUserId, discoverOccupantIds, occupantEffort, isInsignificant, DEFAULT_CFG };
