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

/**
 * High-level entry point — runs the full backfill pass.
 *
 * @param {Object} input
 * @param {Array<Object>} input.entities         - sessionData.entities
 * @param {number} input.thresholdMs             - GuestAssignmentService.thresholdMs
 * @param {number} [input.sessionEndTime]        - fallback for open segments
 * @returns {{
 *   perDevice: Map<string, Array<Object>>,
 *   transfers: Array<{ fromOccupantId, toOccupantId, reason }>,
 *   keptOccupants: Set<string>,
 *   removedOccupants: Set<string>
 * }}
 */
export function runSessionBackfill({ entities, thresholdMs, sessionEndTime } = {}) {
  const perDevice = buildSegmentsPerDevice(entities, sessionEndTime);
  const allTransfers = [];

  for (const segments of perDevice.values()) {
    // Pass 1: cycling detection (OI-2).
    detectCyclingSegments(segments, thresholdMs);
    // Pass 2: absorb sub-T per the rules.
    const transfers = applyAbsorbRules(segments, thresholdMs);
    allTransfers.push(...transfers);
  }

  // Dedup transfers: if A→B appears twice (e.g. across devices) only run once.
  const seen = new Set();
  const dedupTransfers = [];
  for (const t of allTransfers) {
    const key = `${t.fromOccupantId}>${t.toOccupantId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupTransfers.push(t);
  }

  return {
    perDevice,
    transfers: dedupTransfers,
    keptOccupants: collectKeptOccupants(perDevice),
    removedOccupants: collectFullyAbsorbedOccupants(perDevice)
  };
}
