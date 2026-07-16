/**
 * sessionBackfill.js — Session-end backfill pass (W1.B).
 *
 * Walks the per-device segment history and resolves sub-threshold transitions
 * the in-session GuestAssignmentService flow couldn't handle.
 *
 * Three rules per audit Decision §7 (OI-1, OI-2, OI-3):
 *
 *   Rule 1 — Late-tag Pikachu merge (Decision §5)
 *     A synthetic (Pikachu) occupant followed by a real configured user is
 *     ALWAYS absorbed forward, regardless of duration. Late tagging means
 *     "I'm telling you now who this was" → merge.
 *
 *   Rule 2 — OI-1 Final-segment backward absorption
 *     If the final segment of a device is sub-threshold and has no successor
 *     to absorb into, backfill BACKWARD into the prior honored segment on
 *     the same device.
 *
 *   Rule 3 — OI-2 Cycling detection
 *     3+ consecutive sub-threshold segments alternating between 2+ distinct
 *     occupants is "shared device" turn-taking — honor ALL segments.
 *
 * Pure function: no side effects. Returns a plan (segments + transfers) the
 * caller applies via the session's transferUserSeries / participant rebuild.
 *
 * @see /docs/_wip/audits/2026-05-26-guest-mode-ux-audit.md (Decisions §5 / §7)
 * @see /docs/_wip/plans/2026-05-26-guest-mode-redesign-spec.md (W1.B)
 */

/**
 * Conservative detector for synthetic / "Pikachu" occupant IDs.
 *
 * Synthetic IDs come from two paths:
 *   - `guest-<timestamp>` from GuestAssignmentService.assignGuest when no
 *     profileId is provided (see line 129 of GuestAssignmentService.js).
 *   - `#<deviceId>` legacy form used by older Pikachu cards.
 *
 * NOT considered Pikachu:
 *   - `guest_<deviceId>` (W2 — explicit device-keyed generic Guest tag; this
 *     is an intentional anonymous identity, not an unidentified device).
 *   - Anything else (real configured user IDs).
 *
 * @param {string} id
 * @returns {boolean}
 */
export function isPikachuId(id) {
  if (typeof id !== 'string' || !id) return false;
  return id.startsWith('guest-') || id.startsWith('#');
}

/**
 * Build per-device segment lists from the entity snapshot.
 *
 * Each segment carries:
 *   - occupantId (the profileId)
 *   - occupantName
 *   - deviceId
 *   - startTime, endTime, durationMs
 *   - inSessionTransferred  (true if status === 'transferred' — already absorbed in-session)
 *   - entityId
 *
 * Segments per device are sorted by startTime ascending.
 *
 * @param {Array<Object>} entities  - sessionData.entities
 * @param {number} sessionEndTime   - fallback endTime for still-active segments
 * @returns {Map<string, Array<Object>>}  deviceId -> segments
 */
export function buildSegmentsPerDevice(entities, sessionEndTime) {
  const perDevice = new Map();
  if (!Array.isArray(entities)) return perDevice;

  for (const e of entities) {
    if (!e || typeof e !== 'object') continue;
    const deviceId = e.deviceId != null ? String(e.deviceId) : null;
    const occupantId = e.profileId || null;
    if (!deviceId || !occupantId) continue;

    const startTime = Number.isFinite(e.startTime) ? e.startTime : null;
    if (startTime == null) continue;
    const endTime = Number.isFinite(e.endTime) ? e.endTime
      : (Number.isFinite(sessionEndTime) ? sessionEndTime : Date.now());
    const durationMs = Math.max(0, endTime - startTime);

    const seg = {
      entityId: e.entityId || null,
      occupantId,
      occupantName: e.name || occupantId,
      deviceId,
      startTime,
      endTime,
      durationMs,
      status: e.status || 'active',
      inSessionTransferred: e.status === 'transferred',
      // Flags filled in by passes below
      honored: false,
      absorbed: false,
      absorbedInto: null
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
 * Pass 1 — Cycling detection (OI-2).
 *
 * Scans for runs of 3+ consecutive sub-threshold segments where 2+ distinct
 * occupants alternate. All segments in such a run are marked `honored: true`
 * so the absorb pass skips them.
 *
 * Only considers segments that were NOT already transferred in-session — those
 * are out of the analysis window.
 *
 * @param {Array<Object>} segments  - segments for a single device (sorted)
 * @param {number} thresholdMs
 */
export function detectCyclingSegments(segments, thresholdMs) {
  if (!Array.isArray(segments) || segments.length < 3) return;
  const t = Number.isFinite(thresholdMs) ? thresholdMs : 0;

  for (let i = 0; i < segments.length; i++) {
    // Skip already-transferred segments — they're not in the analysis window.
    if (segments[i].inSessionTransferred) continue;

    // Build maximal run of consecutive sub-T (non-transferred) segments starting at i.
    const run = [];
    let j = i;
    while (j < segments.length
      && !segments[j].inSessionTransferred
      && segments[j].durationMs < t) {
      run.push(segments[j]);
      j++;
    }

    if (run.length >= 3) {
      const distinct = new Set(run.map(s => s.occupantId));
      if (distinct.size >= 2) {
        run.forEach(s => { s.honored = true; });
        i = j - 1; // Skip past the run (continue from segment after it)
      }
    }
  }
}

/**
 * Pass 2 — Absorb sub-threshold segments per the W1.B rules.
 *
 * Iterates each device's segments and decides absorptions. Returns the list
 * of (fromOccupantId, toOccupantId) transfers that the caller must apply to
 * the timeline series.
 *
 * Rules (per Decision §7):
 *   Rule 1 — Late-tag Pikachu merge (forward, regardless of duration).
 *   OI-3   — Sub-threshold non-final segment absorbs forward into successor.
 *   OI-1   — Sub-threshold FINAL segment absorbs backward into prior honored.
 *   OI-2   — Honored (cycling) segments are skipped entirely.
 *
 * In-session-transferred segments are also skipped — they're already merged.
 *
 * @param {Array<Object>} segments
 * @param {number} thresholdMs
 * @returns {Array<{ fromOccupantId: string, toOccupantId: string, reason: string }>}
 */
export function applyAbsorbRules(segments, thresholdMs) {
  const transfers = [];
  if (!Array.isArray(segments) || segments.length === 0) return transfers;
  const t = Number.isFinite(thresholdMs) ? thresholdMs : 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.absorbed || seg.honored || seg.inSessionTransferred) continue;

    const next = i + 1 < segments.length ? segments[i + 1] : null;

    // Rule 1: late-tag Pikachu (Pikachu followed by a real configured user).
    const isLatePikachuTag = isPikachuId(seg.occupantId)
      && next != null
      && !next.honored
      && !next.inSessionTransferred
      && !isPikachuId(next.occupantId);

    const isSubT = seg.durationMs < t;

    if (!isLatePikachuTag && !isSubT) continue;

    if (next && !next.inSessionTransferred) {
      // Forward absorb into successor.
      if (next.occupantId !== seg.occupantId) {
        transfers.push({
          fromOccupantId: seg.occupantId,
          toOccupantId: next.occupantId,
          reason: isLatePikachuTag ? 'late-pikachu-tag' : 'sub-threshold-forward'
        });
      }
      seg.absorbed = true;
      seg.absorbedInto = next.occupantId;
      continue;
    }

    // OI-1: final segment with no successor — backfill backward into prior honored.
    // Walk backward to find the nearest segment that is honored AND not absorbed
    // AND has a different occupant. Skip already-absorbed segments since their
    // data lives elsewhere now.
    if (isSubT) {
      let priorIdx = i - 1;
      while (priorIdx >= 0) {
        const p = segments[priorIdx];
        if (!p.absorbed && (p.honored || !p.inSessionTransferred)) {
          if (p.occupantId !== seg.occupantId) {
            transfers.push({
              fromOccupantId: seg.occupantId,
              toOccupantId: p.occupantId,
              reason: 'final-sub-threshold-backward'
            });
            seg.absorbed = true;
            seg.absorbedInto = p.occupantId;
          }
          break;
        }
        priorIdx--;
      }
      // If no prior found, leave the segment as-is (lone short segment).
    }
  }

  return transfers;
}

/**
 * Compute the resolved set of "kept" occupant IDs after the backfill pass.
 *
 * An occupant is kept if any of their segments (on any device) is honored or
 * not absorbed and not in-session-transferred.
 *
 * @param {Map<string, Array<Object>>} perDevice
 * @returns {Set<string>}
 */
export function collectKeptOccupants(perDevice) {
  const kept = new Set();
  for (const segments of perDevice.values()) {
    for (const seg of segments) {
      if (seg.inSessionTransferred) continue;
      if (seg.absorbed) continue;
      // Honored OR untouched — kept.
      kept.add(seg.occupantId);
    }
  }
  return kept;
}

/**
 * Compute the set of occupants whose segments were ALL absorbed (or all
 * in-session-transferred). These should be removed from the participant list.
 *
 * Note: if an occupant has at least one kept segment somewhere, they remain.
 *
 * @param {Map<string, Array<Object>>} perDevice
 * @returns {Set<string>}
 */
export function collectFullyAbsorbedOccupants(perDevice) {
  const allOccupants = new Set();
  const kept = collectKeptOccupants(perDevice);
  for (const segments of perDevice.values()) {
    for (const seg of segments) {
      allOccupants.add(seg.occupantId);
    }
  }
  const removed = new Set();
  for (const id of allOccupants) {
    if (!kept.has(id)) removed.add(id);
  }
  return removed;
}

export const DEFAULT_INSIGNIFICANT_USAGE = { maxCoins: 1, maxActiveZoneSeconds: 5, maxHrSamples: 3 };

const ACTIVE_ZONE_VALUES = new Set(['active', 'warm', 'hot', 'a', 'w', 'h']);

export function computeOccupantEffort(series, occupantId, { intervalSeconds = 5 } = {}) {
  const s = series && typeof series === 'object' ? series : {};
  const hr = Array.isArray(s[`user:${occupantId}:heart_rate`]) ? s[`user:${occupantId}:heart_rate`] : [];
  const zone = Array.isArray(s[`user:${occupantId}:zone_id`]) ? s[`user:${occupantId}:zone_id`] : [];
  const coinsArr = Array.isArray(s[`user:${occupantId}:coins_total`]) ? s[`user:${occupantId}:coins_total`] : [];

  const hrSampleCount = hr.filter((v) => Number.isFinite(v) && v > 0).length;
  const activeTicks = zone.filter((z) => ACTIVE_ZONE_VALUES.has(z)).length;
  const activeWarmZoneSeconds = activeTicks * (Number.isFinite(intervalSeconds) ? intervalSeconds : 5);

  let coins = 0;
  for (let i = coinsArr.length - 1; i >= 0; i--) {
    if (coinsArr[i] != null) { coins = coinsArr[i]; break; }
  }
  return { coins, activeWarmZoneSeconds, hrSampleCount };
}

export function isInsignificantEffort(effort, cfg = DEFAULT_INSIGNIFICANT_USAGE) {
  if (!effort) return true;
  return effort.coins <= cfg.maxCoins
    && effort.activeWarmZoneSeconds <= cfg.maxActiveZoneSeconds
    && effort.hrSampleCount < cfg.maxHrSamples;
}

/**
 * Predicate: is this a known configured user (not a synthetic guest)?
 *
 * Returns false for:
 *   - `guest-*` (Pikachu unidentified form)
 *   - `#*` (legacy Pikachu form)
 *   - `guest_*` (device-keyed explicit generic Guest)
 *
 * Returns true for configured user IDs.
 *
 * @param {string} id
 * @returns {boolean}
 */
export function isKnownUserId(id) {
  if (typeof id !== 'string' || !id) return false;
  if (isPikachuId(id)) return false;      // guest-* / #*
  if (id.startsWith('guest_')) return false; // device-keyed generic guest
  return true;
}

/**
 * Build occupancy segments with effort, including series-only occupants.
 *
 * This function extends buildSegmentsPerDevice by:
 *   1. Computing effort (coins, activeWarmZoneSeconds, hrSampleCount) for every segment
 *   2. Creating synthetic segments for occupants who appear in the series
 *      (user:<id>:heart_rate key) but have no entity (no actual session device record).
 *
 * Series-only occupants are attributed to a device via successor-fallback:
 *   - If exactly one device exists, use it.
 *   - Otherwise, use the device whose first entity has the earliest startTime.
 *   - If no devices exist, the occupant is skipped.
 *
 * Series-only segments carry:
 *   - entityId: null
 *   - occupantId, occupantName (both set to the user ID)
 *   - deviceId (via successor-fallback)
 *   - startTime: -1, endTime: -1, durationMs: 0
 *   - status: 'series-only'
 *   - inSessionTransferred, honored, absorbed, absorbedInto: false/null
 *   - effort: computed from the series
 *
 * Series-only segments are prepended to the device's segment list (ghost precedes the honored).
 *
 * @param {Object} input
 * @param {Array<Object>} input.entities
 * @param {Object} input.series         - timeseries data (user:<id>:heart_rate keys)
 * @param {number} input.sessionEndTime
 * @param {number} [input.intervalSeconds=5]
 * @returns {Map<string, Array<Object>>}  deviceId -> segments (with effort, including series-only)
 */
export function buildOccupancySegments({ entities, series, sessionEndTime, intervalSeconds = 5 } = {}) {
  const perDevice = buildSegmentsPerDevice(entities, sessionEndTime);

  // Attach effort to every entity-backed segment.
  for (const segs of perDevice.values()) {
    for (const seg of segs) {
      seg.effort = computeOccupantEffort(series, seg.occupantId, { intervalSeconds });
    }
  }

  // Series-only occupants: appear as user:<id>:heart_rate but have no entity.
  const s = series && typeof series === 'object' ? series : {};
  const entityOccupants = new Set();
  for (const segs of perDevice.values()) for (const seg of segs) entityOccupants.add(seg.occupantId);

  const seriesOccupants = new Set();
  for (const key of Object.keys(s)) {
    const m = /^user:(.+):heart_rate$/.exec(key);
    if (m) seriesOccupants.add(m[1]);
  }

  const deviceIds = [...perDevice.keys()];
  for (const occ of seriesOccupants) {
    if (entityOccupants.has(occ)) continue;
    // Successor-fallback: if exactly one device, use it; else the earliest-start device.
    const deviceId = deviceIds.length === 1
      ? deviceIds[0]
      : (deviceIds.length ? deviceIds.slice().sort((a, b) => {
          const sa = perDevice.get(a)[0]?.startTime ?? Infinity;
          const sb = perDevice.get(b)[0]?.startTime ?? Infinity;
          return sa - sb;
        })[0] : null);
    if (!deviceId) continue;
    const effort = computeOccupantEffort(s, occ, { intervalSeconds });
    const seg = {
      entityId: null, occupantId: occ, occupantName: occ, deviceId,
      startTime: -1, endTime: -1, durationMs: 0,
      status: 'series-only', inSessionTransferred: false,
      honored: false, absorbed: false, absorbedInto: null, effort
    };
    perDevice.get(deviceId).unshift(seg); // series-only ghost precedes the honored occupant
  }
  return perDevice;
}

/**
 * Effort-based absorb: an insignificant, non-honored segment folds forward into
 * its device successor; if none, backward into the prior substantial occupant.
 *
 * @param {Array<Object>} segments
 * @param {Object} cfg  - DEFAULT_INSIGNIFICANT_USAGE-shaped config
 * @returns {Array<{ fromOccupantId, toOccupantId, reason }>}
 */
export function applyEffortAbsorb(segments, cfg) {
  const transfers = [];
  if (!Array.isArray(segments)) return transfers;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.absorbed || seg.honored || seg.inSessionTransferred) continue;
    if (!isInsignificantEffort(seg.effort, cfg)) continue;
    const next = segments.slice(i + 1).find(s => !s.inSessionTransferred && s.occupantId !== seg.occupantId);
    if (next) {
      transfers.push({ fromOccupantId: seg.occupantId, toOccupantId: next.occupantId, reason: 'insignificant-forward' });
      seg.absorbed = true; seg.absorbedInto = next.occupantId; continue;
    }
    const prior = segments.slice(0, i).reverse().find(s => !s.absorbed && !s.inSessionTransferred && s.occupantId !== seg.occupantId);
    if (prior) {
      transfers.push({ fromOccupantId: seg.occupantId, toOccupantId: prior.occupantId, reason: 'insignificant-backward' });
      seg.absorbed = true; seg.absorbedInto = prior.occupantId;
    }
  }
  return transfers;
}

/**
 * Cross-device merge for a single known user recorded under alias ids.
 *
 * @param {Map<string, Array<Object>>} perDevice
 * @param {Object} [knownUserAliases]  - map of rawId -> canonicalId
 * @returns {Array<{ fromOccupantId, toOccupantId, reason: 'known-user-device-swap' }>}
 */
export function applyKnownUserDeviceMerge(perDevice, knownUserAliases = {}) {
  const merges = [];
  const canonical = (id) => knownUserAliases[id] || id;
  // Group surviving (non-absorbed) segments by canonical known-user id → set of raw ids/devices.
  const rawByCanonical = new Map();
  for (const segs of perDevice.values()) {
    for (const seg of segs) {
      if (seg.absorbed || seg.inSessionTransferred) continue;
      if (!isKnownUserId(seg.occupantId)) continue;
      const c = canonical(seg.occupantId);
      if (!rawByCanonical.has(c)) rawByCanonical.set(c, new Set());
      rawByCanonical.get(c).add(seg.occupantId);
    }
  }
  for (const [c, rawIds] of rawByCanonical.entries()) {
    for (const raw of rawIds) {
      if (raw === c) continue;
      merges.push({ fromOccupantId: raw, toOccupantId: c, reason: 'known-user-device-swap' });
    }
  }
  return merges;
}

/**
 * High-level entry point — runs the full backfill pass.
 *
 * When `series` is supplied, runs BOTH the duration/identity-based rules
 * (Rule 1 late-tag Pikachu, OI-1 backward, OI-3 forward — same
 * `applyAbsorbRules` used by the legacy path) AND the effort-based absorb
 * pass (near-zero coins/active-zone-time/HR-samples ghosts, regardless of
 * duration), plus cross-device known-user merging. These two rule sets test
 * different signals (identity/duration vs. measured effort) and are
 * complementary, not exclusive — a segment already absorbed by one is
 * skipped by the other via the shared `seg.absorbed` guard. When `series` is
 * omitted, falls back to the legacy duration-only path (existing callers
 * unaffected).
 *
 * @param {Object} input
 * @param {Array<Object>} input.entities         - sessionData.entities
 * @param {Object} [input.series]                - timeseries data (user:<id>:heart_rate keys); triggers effort-based path
 * @param {number} input.thresholdMs             - GuestAssignmentService.thresholdMs (legacy path)
 * @param {number} [input.sessionEndTime]        - fallback for open segments
 * @param {Object} [input.insignificantUsage]    - DEFAULT_INSIGNIFICANT_USAGE-shaped config override
 * @param {number} [input.intervalSeconds=5]     - sample interval for effort computation
 * @param {Object} [input.knownUserAliases]      - map of rawId -> canonicalId for cross-device merge
 * @returns {{
 *   perDevice: Map<string, Array<Object>>,
 *   transfers: Array<{ fromOccupantId, toOccupantId, reason }>,
 *   merges: Array<{ fromOccupantId, toOccupantId, reason: 'known-user-device-swap' }>,
 *   keptOccupants: Set<string>,
 *   removedOccupants: Set<string>
 * }}
 */
export function runSessionBackfill({ entities, series, thresholdMs, sessionEndTime, insignificantUsage, intervalSeconds = 5, knownUserAliases = {} } = {}) {
  // Legacy duration-only path preserved when no series is supplied.
  if (!series) {
    const perDevice = buildSegmentsPerDevice(entities, sessionEndTime);
    const allTransfers = [];
    for (const segments of perDevice.values()) {
      detectCyclingSegments(segments, thresholdMs);
      allTransfers.push(...applyAbsorbRules(segments, thresholdMs));
    }
    const t = dedupeTransfers(allTransfers);
    return { perDevice, transfers: t, merges: [], keptOccupants: collectKeptOccupants(perDevice), removedOccupants: collectFullyAbsorbedOccupants(perDevice) };
  }

  const cfg = insignificantUsage || DEFAULT_INSIGNIFICANT_USAGE;
  const perDevice = buildOccupancySegments({ entities, series, sessionEndTime, intervalSeconds });
  const allTransfers = [];
  for (const segments of perDevice.values()) {
    detectCyclingSegments(segments, thresholdMs); // OI-2 still protects real turn-taking
    // Identity/duration rules first (late-tag Pikachu forward, OI-1 backward,
    // OI-3 forward sub-threshold) — same rules the legacy no-series path
    // uses. Then the effort-based pass catches ghosts these rules don't
    // (e.g. a segment that runs LONGER than the threshold but registers
    // near-zero coins/HR/active-zone effort). The shared `seg.absorbed`
    // guard means whichever rule matches first "wins" — there is no
    // double-transfer risk.
    allTransfers.push(...applyAbsorbRules(segments, thresholdMs));
    allTransfers.push(...applyEffortAbsorb(segments, cfg));
  }
  const merges = applyKnownUserDeviceMerge(perDevice, knownUserAliases);
  const mergedFromIds = merges.map(m => m.fromOccupantId);
  const keptOccupants = collectKeptOccupants(perDevice);
  for (const id of mergedFromIds) keptOccupants.delete(id);
  return {
    perDevice,
    transfers: dedupeTransfers(allTransfers),
    merges,
    keptOccupants,
    removedOccupants: new Set([...collectFullyAbsorbedOccupants(perDevice), ...mergedFromIds])
  };
}

function dedupeTransfers(list) {
  const seen = new Set(); const out = [];
  for (const t of list) { const k = `${t.fromOccupantId}>${t.toOccupantId}`; if (seen.has(k)) continue; seen.add(k); out.push(t); }
  return out;
}
