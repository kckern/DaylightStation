# Fitness Session Identity Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a shuffled HR strap from crystallizing ghost participants and unify a known user who swaps devices — both live (at save) and retroactively across stored sessions.

**Architecture:** A pure decision core turns per-device occupancy *segments* (with an **effort** summary) into a plan of merges + absorptions. It runs in two parallel implementations: the **frontend** live save path (`sessionBackfill.js`, extended) and a **backend** healer + CLI (`SessionIdentityHealer.mjs` + `heal-fitness-sessions.cli.mjs`) for retroactive sweep/heal. Both are pinned to the same golden fixture (`20260627195941`) for parity. A small in-session fix (`GuestAssignmentService` close-on-reassign) keeps the live roster and segment model honest.

**Tech Stack:** JavaScript ESM. Frontend: React hooks under `frontend/src/hooks/fitness/`, tests in Vitest. Backend: Node ESM under `backend/src/`, `#domains/*` import aliases, tests in Vitest (`*.test.mjs`). YAML via `js-yaml`. RLE series via `SessionSerializerV3` (frontend) / `TimelineService.mjs` (backend).

## Global Constraints

- **Effort test replaces wall-clock duration as the absorb gate.** A segment is *insignificant* iff `coins ≤ max_coins` AND `activeWarmZoneSeconds ≤ max_active_zone_seconds` AND `hrSampleCount < max_hr_samples`. Config `governance.insignificant_usage = { max_coins: 1, max_active_zone_seconds: 5, max_hr_samples: 3 }` (starting values).
- **Cross-device merge applies to configured/known users only** — never synthetic guests (`guest-*`, `#*`, `guest_*`). Reuse `isPikachuId` and extend with a `guest_`-prefix check for the known-user predicate.
- **Series metric names differ by representation.** In-memory (frontend save time): `user:<id>:heart_rate | zone_id | coins_total | heart_beats`. On-disk (backend heal): flat `<id>:hr | zone | coins | beats`, RLE-encoded strings; zone letters `c/a/w/h`; `interval_seconds` (default 5) at `timeline.interval_seconds`.
- **Pure cores have no side effects.** They return plans; callers apply them.
- **Preserve existing behavior:** OI-2 cycling detection (3+ alternating substantial segments = shared-strap turn-taking) must still keep all participants. Existing `sessionBackfill` exports keep working (the duration path is demoted, not deleted).
- **Frontend/backend parity is asserted on the `20260627195941` golden fixture:** expected outcome = `grannie` sole participant; `soren` + `elizabeth` removed; grannie's coins/zone-minutes unchanged.
- **Commit after every task.** On `kckern-server` committing is allowed; do NOT deploy as part of plan execution.

---

## File Structure

**Frontend (live path):**
- Modify `frontend/src/hooks/fitness/sessionBackfill.js` — add effort model, series-only segment sourcing, effort-based absorb, cross-device known-user merge; extend `runSessionBackfill`.
- Modify `frontend/src/hooks/fitness/PersistenceManager.js` — pass `series` + `insignificantUsage` + `isKnownUser` into `runSessionBackfill`; apply merges; add `setInsignificantUsageConfig`.
- Modify `frontend/src/hooks/fitness/GuestAssignmentService.js` — close-on-reassign; guarantee an entity per assignment.
- Tests: `sessionBackfill.effort.test.js`, `sessionBackfill.deviceMerge.test.js`, `sessionBackfill.golden.test.js`, `GuestAssignmentService.closeOnReassign.test.js`.

**Backend (retroactive):**
- Create `backend/src/2_domains/fitness/services/SessionIdentityHealer.mjs` — pure healer over decoded on-disk series.
- Create `cli/heal-fitness-sessions.cli.mjs` — single heal + sweep.
- Tests: `backend/src/2_domains/fitness/services/SessionIdentityHealer.test.mjs`, `SessionIdentityHealer.golden.test.mjs`.

**Shared fixture:**
- Create `frontend/src/hooks/fitness/__fixtures__/session-20260627195941.json` and `backend/src/2_domains/fitness/services/__fixtures__/session-20260627195941.yml` (trimmed real data — 3 occupants, 1 device).

---

## PHASE 1 — Frontend decision core (`sessionBackfill.js`)

### Task 1: Effort model + insignificance test

**Files:**
- Modify: `frontend/src/hooks/fitness/sessionBackfill.js`
- Test: `frontend/src/hooks/fitness/sessionBackfill.effort.test.js`

**Interfaces:**
- Produces: `computeOccupantEffort(series, occupantId, { intervalSeconds }) → { coins, activeWarmZoneSeconds, hrSampleCount }`; `DEFAULT_INSIGNIFICANT_USAGE = { maxCoins: 1, maxActiveZoneSeconds: 5, maxHrSamples: 3 }`; `isInsignificantEffort(effort, cfg) → boolean`.
- Series keys read: `user:${occupantId}:heart_rate` (count non-null > 0), `user:${occupantId}:zone_id` (values `active|warm|hot|a|w|h`), `user:${occupantId}:coins_total` (last non-null value).

- [ ] **Step 1: Write the failing test**

```javascript
// sessionBackfill.effort.test.js
import { describe, it, expect } from 'vitest';
import { computeOccupantEffort, isInsignificantEffort, DEFAULT_INSIGNIFICANT_USAGE } from './sessionBackfill.js';

const series = (o) => o;

describe('computeOccupantEffort', () => {
  it('counts hr samples, active/warm seconds, and last coin total', () => {
    const s = series({
      'user:a:heart_rate': [null, 120, 0, 130, null],   // 2 valid samples
      'user:a:zone_id':    [null, 'active', 'cool', 'warm', 'hot'], // 3 active/warm/hot ticks
      'user:a:coins_total':[0, 1, 3, 3, 3]              // last = 3
    });
    const e = computeOccupantEffort(s, 'a', { intervalSeconds: 5 });
    expect(e).toEqual({ coins: 3, activeWarmZoneSeconds: 15, hrSampleCount: 2 });
  });

  it('treats a missing occupant as zero effort', () => {
    expect(computeOccupantEffort({}, 'ghost', { intervalSeconds: 5 }))
      .toEqual({ coins: 0, activeWarmZoneSeconds: 0, hrSampleCount: 0 });
  });
});

describe('isInsignificantEffort', () => {
  const cfg = DEFAULT_INSIGNIFICANT_USAGE;
  it('is true for a near-idle strap regardless of duration', () => {
    expect(isInsignificantEffort({ coins: 1, activeWarmZoneSeconds: 0, hrSampleCount: 2 }, cfg)).toBe(true);
  });
  it('is false when any effort signal exceeds its bound', () => {
    expect(isInsignificantEffort({ coins: 5, activeWarmZoneSeconds: 0, hrSampleCount: 2 }, cfg)).toBe(false);
    expect(isInsignificantEffort({ coins: 0, activeWarmZoneSeconds: 30, hrSampleCount: 2 }, cfg)).toBe(false);
    expect(isInsignificantEffort({ coins: 0, activeWarmZoneSeconds: 0, hrSampleCount: 50 }, cfg)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/fitness/sessionBackfill.effort.test.js`
Expected: FAIL — `computeOccupantEffort is not a function`.

- [ ] **Step 3: Write minimal implementation** (append to `sessionBackfill.js`)

```javascript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/fitness/sessionBackfill.effort.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/sessionBackfill.js frontend/src/hooks/fitness/sessionBackfill.effort.test.js
git commit -m "feat(fitness): effort model + insignificance test for session reconciliation"
```

---

### Task 2: Series-only occupancy segments + known-user predicate

**Files:**
- Modify: `frontend/src/hooks/fitness/sessionBackfill.js`
- Test: `frontend/src/hooks/fitness/sessionBackfill.effort.test.js` (extend)

**Interfaces:**
- Consumes: `buildSegmentsPerDevice(entities, sessionEndTime)` (existing), `computeOccupantEffort` (Task 1).
- Produces: `isKnownUserId(id) → boolean` (true unless `guest-*` / `#*` / `guest_*`); `buildOccupancySegments({ entities, series, sessionEndTime, intervalSeconds }) → Map<deviceId, segment[]>` — same shape as `buildSegmentsPerDevice` PLUS `effort` on every segment AND synthetic segments for occupants who appear in `series` (a `user:<id>:heart_rate` key) but have no entity, attributed to a device by successor-fallback (the device whose entities are closest in start time; if only one device exists, that device).

- [ ] **Step 1: Write the failing test** (append)

```javascript
import { isKnownUserId, buildOccupancySegments } from './sessionBackfill.js';

describe('isKnownUserId', () => {
  it('rejects synthetic guest ids, accepts configured ids', () => {
    expect(isKnownUserId('grannie')).toBe(true);
    expect(isKnownUserId('guest-123')).toBe(false);
    expect(isKnownUserId('#90006')).toBe(false);
    expect(isKnownUserId('guest_29413')).toBe(false);
  });
});

describe('buildOccupancySegments', () => {
  it('adds a synthetic segment for a series-only occupant (no entity)', () => {
    const entities = [
      { entityId: 'e1', profileId: 'grannie', deviceId: '29413', startTime: 400, endTime: null, status: 'active' }
    ];
    const series = {
      'user:soren:heart_rate': [116, 116, null],
      'user:grannie:heart_rate': [null, null, 80]
    };
    const per = buildOccupancySegments({ entities, series, sessionEndTime: 1000, intervalSeconds: 5 });
    const segs = per.get('29413');
    const ids = segs.map((s) => s.occupantId).sort();
    expect(ids).toEqual(['grannie', 'soren']);
    expect(segs.every((s) => s.effort)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/fitness/sessionBackfill.effort.test.js`
Expected: FAIL — `buildOccupancySegments is not a function`.

- [ ] **Step 3: Write minimal implementation** (append to `sessionBackfill.js`)

```javascript
export function isKnownUserId(id) {
  if (typeof id !== 'string' || !id) return false;
  if (isPikachuId(id)) return false;      // guest-* / #*
  if (id.startsWith('guest_')) return false; // device-keyed generic guest
  return true;
}

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/fitness/sessionBackfill.effort.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/sessionBackfill.js frontend/src/hooks/fitness/sessionBackfill.effort.test.js
git commit -m "feat(fitness): series-only occupancy segments + known-user predicate"
```

---

### Task 3: Effort-based absorb + cross-device known-user merge in `runSessionBackfill`

**Files:**
- Modify: `frontend/src/hooks/fitness/sessionBackfill.js`
- Test: `frontend/src/hooks/fitness/sessionBackfill.deviceMerge.test.js`

**Interfaces:**
- Consumes: `buildOccupancySegments`, `isInsignificantEffort`, `isKnownUserId`, existing `detectCyclingSegments`.
- Produces: extended `runSessionBackfill({ entities, series, sessionEndTime, insignificantUsage, intervalSeconds }) → { perDevice, transfers, merges, keptOccupants, removedOccupants }`. `merges: Array<{ fromOccupantId, toOccupantId, reason:'known-user-device-swap' }>`. When `series` is omitted, behavior falls back to the legacy duration path (existing callers unaffected).

- [ ] **Step 1: Write the failing test**

```javascript
// sessionBackfill.deviceMerge.test.js
import { describe, it, expect } from 'vitest';
import { runSessionBackfill } from './sessionBackfill.js';

describe('runSessionBackfill — effort absorb', () => {
  it('absorbs an idle-long ghost forward into the real occupant', () => {
    const entities = [
      { entityId: 'g1', profileId: 'elizabeth', deviceId: '29413', startTime: 0,   endTime: 300000, status: 'active' },
      { entityId: 'g2', profileId: 'grannie',   deviceId: '29413', startTime: 300000, endTime: null, status: 'active' }
    ];
    const series = {
      'user:elizabeth:heart_rate': [116, null, null],
      'user:grannie:heart_rate':   [null, 80, 90]
    };
    const r = runSessionBackfill({ entities, series, sessionEndTime: 600000 });
    expect([...r.removedOccupants]).toContain('elizabeth');
    expect(r.transfers.some(t => t.fromOccupantId === 'elizabeth' && t.toOccupantId === 'grannie')).toBe(true);
  });
});

describe('runSessionBackfill — known-user device swap merge', () => {
  it('unions the same known user across two devices', () => {
    const entities = [
      { entityId: 'a', profileId: 'kckern', deviceId: 'D1', startTime: 0,   endTime: 60000, status: 'active' },
      { entityId: 'b', profileId: 'kckern', deviceId: 'D2', startTime: 60000, endTime: null, status: 'active' }
    ];
    const series = {
      'user:kckern:heart_rate': [120, 121, 122, 123],
      'user:kckern:coins_total': [10, 20, 30, 40]
    };
    const r = runSessionBackfill({ entities, series, sessionEndTime: 120000 });
    // Same id on both devices → no merge transfer needed (already one identity), no removal.
    expect([...r.removedOccupants]).toHaveLength(0);
    expect(r.merges).toEqual([]); // same occupantId, nothing to rename
  });

  it('merges two DISTINCT known-user segments on different devices into one', () => {
    // Simulates a strap-swap recorded under two ids that map to the same known user.
    const entities = [
      { entityId: 'a', profileId: 'kckern',      deviceId: 'D1', startTime: 0,   endTime: 60000, status: 'active' },
      { entityId: 'b', profileId: 'kckern_alt',  deviceId: 'D2', startTime: 60000, endTime: null, status: 'active' }
    ];
    const series = {
      'user:kckern:heart_rate':     [120, 121, null, null],
      'user:kckern_alt:heart_rate': [null, null, 130, 131]
    };
    const r = runSessionBackfill({
      entities, series, sessionEndTime: 120000,
      knownUserAliases: { kckern_alt: 'kckern' }
    });
    expect(r.merges).toContainEqual({ fromOccupantId: 'kckern_alt', toOccupantId: 'kckern', reason: 'known-user-device-swap' });
    expect([...r.removedOccupants]).toContain('kckern_alt');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/fitness/sessionBackfill.deviceMerge.test.js`
Expected: FAIL — `r.merges` undefined / removals absent.

- [ ] **Step 3: Write minimal implementation** — replace the body of `runSessionBackfill` and add helpers

```javascript
// Effort-based absorb: an insignificant, non-honored segment folds forward into
// its device successor; if none, backward into the prior substantial occupant.
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
    const prior = segments.slice(0, i).reverse().find(s => !s.absorbed && s.occupantId !== seg.occupantId);
    if (prior) {
      transfers.push({ fromOccupantId: seg.occupantId, toOccupantId: prior.occupantId, reason: 'insignificant-backward' });
      seg.absorbed = true; seg.absorbedInto = prior.occupantId;
    }
  }
  return transfers;
}

// Cross-device merge for a single known user recorded under alias ids.
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
    allTransfers.push(...applyEffortAbsorb(segments, cfg));
  }
  const merges = applyKnownUserDeviceMerge(perDevice, knownUserAliases);
  return {
    perDevice,
    transfers: dedupeTransfers(allTransfers),
    merges,
    keptOccupants: collectKeptOccupants(perDevice),
    removedOccupants: new Set([...collectFullyAbsorbedOccupants(perDevice), ...merges.map(m => m.fromOccupantId)])
  };
}

function dedupeTransfers(list) {
  const seen = new Set(); const out = [];
  for (const t of list) { const k = `${t.fromOccupantId}>${t.toOccupantId}`; if (seen.has(k)) continue; seen.add(k); out.push(t); }
  return out;
}
```

Note: the old inline dedup block in the original `runSessionBackfill` is replaced by the `dedupeTransfers` helper; delete the superseded original function body.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/hooks/fitness/sessionBackfill.deviceMerge.test.js src/hooks/fitness/sessionBackfill.effort.test.js`
Expected: PASS.

- [ ] **Step 5: Run the existing backfill suite for regressions**

Run: `cd frontend && npx vitest run src/hooks/fitness/PersistenceManager.lateTagMerge.test.js src/hooks/fitness/PersistenceManager.symmetricTransitions.test.js`
Expected: PASS (legacy no-series path unchanged).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/sessionBackfill.js frontend/src/hooks/fitness/sessionBackfill.deviceMerge.test.js
git commit -m "feat(fitness): effort-based absorb + cross-device known-user merge"
```

---

## PHASE 2 — Frontend live-path integration (`PersistenceManager.js`)

### Task 4: Feed series + config + aliases into the backfill and apply merges

**Files:**
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js` (`_applyBackfill`, add `setInsignificantUsageConfig`, `setKnownUserAliases`)
- Test: `frontend/src/hooks/fitness/PersistenceManager.effortBackfill.test.js`

**Interfaces:**
- Consumes: `runSessionBackfill({ entities, series, sessionEndTime, insignificantUsage, intervalSeconds, knownUserAliases })`, existing `_mergeUserSeriesInPlace(series, from, to)`.
- Produces: participant list drops `removedOccupants` (existing exclude path at `PersistenceManager.js:185`); `result.merges` apply the same `_mergeUserSeriesInPlace` as transfers.

- [ ] **Step 1: Write the failing test** — drive `PersistenceManager` with the ghost scenario (mirror `PersistenceManager.lateTagMerge.test.js` harness at lines 22-52) and assert saved `participants` excludes the ghost and its series is emptied.

```javascript
// PersistenceManager.effortBackfill.test.js  (harness copied from lateTagMerge test)
// sessionData: elizabeth (1 hr sample, 0 coins) on device 29413 then grannie (full).
// After persist: capturedPayload.summary.participants has no 'elizabeth';
//   series['user:elizabeth:heart_rate'] is all null; grannie retains her data.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/fitness/PersistenceManager.effortBackfill.test.js`
Expected: FAIL — elizabeth still present.

- [ ] **Step 3: Implement** — in `_applyBackfill` (around `PersistenceManager.js:1244`) pass the new args and apply merges:

```javascript
const series = sessionData.timeline?.series;
const intervalSeconds = Number.isFinite(sessionData.timeline?.interval_seconds)
  ? sessionData.timeline.interval_seconds : 5;
result = runSessionBackfill({
  entities, series, thresholdMs, sessionEndTime,
  insignificantUsage: this._insignificantUsage,      // set via setInsignificantUsageConfig
  intervalSeconds,
  knownUserAliases: this._knownUserAliases || {}
});
// apply transfers AND merges through the same in-place merge
if (series && typeof series === 'object') {
  for (const { fromOccupantId, toOccupantId } of [...result.transfers, ...(result.merges || [])]) {
    this._mergeUserSeriesInPlace(series, fromOccupantId, toOccupantId);
  }
}
```

Add setters near `setUsageThresholdMs`:

```javascript
setInsignificantUsageConfig(cfg) { if (cfg && typeof cfg === 'object') this._insignificantUsage = cfg; }
setKnownUserAliases(map) { if (map && typeof map === 'object') this._knownUserAliases = map; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/fitness/PersistenceManager.effortBackfill.test.js`
Expected: PASS.

- [ ] **Step 5: Wire config source** — in `FitnessContext` (search `setUsageThresholdMs(` call site) add `pm.setInsignificantUsageConfig(fitnessConfig?.governance?.insignificant_usage)` and `pm.setKnownUserAliases(fitnessConfig?.known_user_aliases)`. Run: `cd frontend && npx vitest run src/hooks/fitness/` Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/PersistenceManager.js frontend/src/hooks/fitness/PersistenceManager.effortBackfill.test.js frontend/src/context/FitnessContext.jsx
git commit -m "feat(fitness): live save path uses effort-based reconciliation + device merge"
```

---

## PHASE 3 — In-session close-on-reassign (`GuestAssignmentService.js`)

### Task 5: Close the superseded entity + guarantee an entity per assignment

**Files:**
- Modify: `frontend/src/hooks/fitness/GuestAssignmentService.js` (the replace branch after `GUEST_REPLACED` / `SEGMENT_ABSORBED`, around lines 155-210)
- Test: `frontend/src/hooks/fitness/GuestAssignmentService.closeOnReassign.test.js`

**Interfaces:**
- Consumes: existing `session.entities` / entity records, `this.ledger`.
- Produces: on any occupant change for a device, the previous entity gets `endTime = now` and `status = 'transferred'` (absorbed) or `'superseded'` (honored); every assignment ensures a live entity for the new occupant.

- [ ] **Step 1: Write the failing test** — assign device `29413` to soren, then grannie; assert the soren entity ends with a finite `endTime` and non-`active` status, and a grannie entity exists.

- [ ] **Step 2: Run to verify it fails.** Run: `cd frontend && npx vitest run src/hooks/fitness/GuestAssignmentService.closeOnReassign.test.js` → FAIL (prior entity still `active`, `endTime` null).

- [ ] **Step 3: Implement** — in both the `isSegmentAbsorbed` and the else (`GUEST_REPLACED`) branches, after logging, close the prior entity:

```javascript
if (previousEntityId && session?.closeEntity) {
  session.closeEntity(previousEntityId, { endTime: now, status: isSegmentAbsorbed ? 'transferred' : 'superseded' });
}
```
If `session.closeEntity` does not exist, add it to `FitnessSession` (find the entity in `this.entities` by `entityId`, set `endTime`/`status`). Ensure the new-occupant entity is created via the existing entity-create path (verify one is always made in `assignGuest`; if the profile has no entity, create it).

- [ ] **Step 4: Run to verify it passes.** Expected: PASS.

- [ ] **Step 5: Regression.** Run: `cd frontend && npx vitest run src/hooks/fitness/GuestAssignmentService.threshold.test.js src/hooks/fitness/FitnessSession.assignmentDurability.test.js` → PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/GuestAssignmentService.js frontend/src/hooks/fitness/FitnessSession.js frontend/src/hooks/fitness/GuestAssignmentService.closeOnReassign.test.js
git commit -m "fix(fitness): close superseded entity on device reassignment"
```

---

## PHASE 4 — Backend healer core (`SessionIdentityHealer.mjs`)

### Task 6: Pure healer over decoded on-disk series

**Files:**
- Create: `backend/src/2_domains/fitness/services/SessionIdentityHealer.mjs`
- Test: `backend/src/2_domains/fitness/services/SessionIdentityHealer.test.mjs`

**Interfaces:**
- Consumes: `decodeSeries` from `#domains/fitness/services/TimelineService.mjs`.
- Produces: `planHeal(sessionYamlObj, cfg) → { removedOccupants: string[], transfers: [{from,to,reason}], merges: [{from,to,reason}], needsHeal: boolean }`. Reads on-disk flat series `<id>:hr | zone | coins`, `timeline.interval_seconds`, `entities`, roster/participants for known-user detection and `known_user_aliases`.

- [ ] **Step 1: Write the failing test** — construct a minimal decoded session obj (elizabeth: 1 hr sample; grannie: full) and assert `planHeal(...).removedOccupants` = `['elizabeth']`, `needsHeal === true`.

- [ ] **Step 2: Run to verify it fails.** Run: `cd backend && npx vitest run src/2_domains/fitness/services/SessionIdentityHealer.test.mjs` → FAIL (module missing).

- [ ] **Step 3: Implement** — mirror the Phase-1 rules against on-disk keys. Effort accessor:

```javascript
import { decodeSeries } from '#domains/fitness/services/TimelineService.mjs';

const ACTIVE = new Set(['active', 'warm', 'hot', 'a', 'w', 'h']);
const DEFAULT_CFG = { maxCoins: 1, maxActiveZoneSeconds: 5, maxHrSamples: 3 };

function occupantEffort(series, id, intervalSeconds) {
  const hr = decodeSeries(series[`${id}:hr`]);
  const zone = decodeSeries(series[`${id}:zone`]);
  const coins = decodeSeries(series[`${id}:coins`]);
  const hrSampleCount = hr.filter(v => Number.isFinite(v) && v > 0).length;
  const activeWarmZoneSeconds = zone.filter(z => ACTIVE.has(z)).length * (intervalSeconds || 5);
  let last = 0; for (let i = coins.length - 1; i >= 0; i--) { if (coins[i] != null) { last = coins[i]; break; } }
  return { coins: last, activeWarmZoneSeconds, hrSampleCount };
}
```

Build segments from `entities` (deviceId/profileId/start/end) plus series-only occupants (`<id>:hr` present, no entity), attribute by successor-fallback, run insignificant-absorb + known-user device merge exactly as Phase 1, and set `needsHeal = removedOccupants.length > 0 || merges.length > 0`. Occupant id discovery from series: keys matching `^(?!device:|vib:|bike:|global:)(.+):hr$`.

- [ ] **Step 4: Run to verify it passes.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/fitness/services/SessionIdentityHealer.mjs backend/src/2_domains/fitness/services/SessionIdentityHealer.test.mjs
git commit -m "feat(fitness): backend SessionIdentityHealer (pure heal planner)"
```

---

### Task 7: Golden-parity fixture (both sides)

**Files:**
- Create: `backend/src/2_domains/fitness/services/__fixtures__/session-20260627195941.yml` (trimmed real session — 3 occupants, device 29413; copy the real `entities`, `timeline.series` participant keys, `interval_seconds`, `summary.participants`).
- Create: `frontend/src/hooks/fitness/__fixtures__/session-20260627195941.json` (same data, in-memory `user:<id>:...` key form).
- Test: `SessionIdentityHealer.golden.test.mjs` + `sessionBackfill.golden.test.js`.

**Interfaces:** none new — asserts both engines on the shared case.

- [ ] **Step 1: Capture the fixture** from the live file (run in container):
```bash
sudo docker exec daylight-station sh -c 'cat data/household/history/fitness/2026-06-27/20260627195941.yml' > /tmp/s.yml
```
Trim to the 3 occupant series + entities + interval_seconds + summary.participants; save both fixture forms.

- [ ] **Step 2: Write both golden tests** — assert: `removedOccupants` == `['elizabeth','soren']` (sorted), `grannie` retained, grannie coins unchanged (966).

- [ ] **Step 3: Run both.** Run: `cd backend && npx vitest run src/2_domains/fitness/services/SessionIdentityHealer.golden.test.mjs` and `cd frontend && npx vitest run src/hooks/fitness/sessionBackfill.golden.test.js` → PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/2_domains/fitness/services/__fixtures__ frontend/src/hooks/fitness/__fixtures__ backend/src/2_domains/fitness/services/SessionIdentityHealer.golden.test.mjs frontend/src/hooks/fitness/sessionBackfill.golden.test.js
git commit -m "test(fitness): golden-parity fixture for session 20260627195941"
```

---

## PHASE 5 — Retroactive heal + sweep CLI

### Task 8: `heal-fitness-sessions.cli.mjs` — single heal (dry-run/apply)

**Files:**
- Create: `cli/heal-fitness-sessions.cli.mjs` (follow `cli/merge-fitness-sessions.cli.mjs` structure: `fs/promises`, `js-yaml`, `TimelineService`, resolve session path under `data/household/history/fitness/<date>/<id>.yml`)
- Test: `cli/heal-fitness-sessions.test.mjs` (load a fixture temp file, run heal, assert rewritten YAML)

**Interfaces:**
- Consumes: `planHeal` (Task 6), `decodeSeries`/`encodeSeries`/`mergeTimelines` (TimelineService), summary-recompute logic (reuse the helpers in `merge-fitness-sessions.cli.mjs` — extract shared `recomputeSummary(sessionObj)` into `cli/lib/fitnessSessionSummary.mjs` if not already shared).

- [ ] **Step 1: Write the failing test** — copy the golden YML to a temp path, run the heal function with `apply:true`, re-read: assert `summary.participants` has only `grannie`; `elizabeth`/`soren` series keys removed; series re-encoded as RLE strings.

- [ ] **Step 2: Run to verify it fails.** → FAIL (CLI missing).

- [ ] **Step 3: Implement** — `heal(date, sessionId, { apply })`: load YAML → `planHeal` → for each transfer/merge `mergeTimelines`/cell-merge the from→to decoded series then delete the from keys → drop removed occupants from `participants` + `summary.participants` → `recomputeSummary` → re-encode → if `apply` write back else print the plan. Arg parsing mirrors merge CLI (validate `YYYY-MM-DD` + 14-digit id).

- [ ] **Step 4: Run to verify it passes.** → PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/heal-fitness-sessions.cli.mjs cli/heal-fitness-sessions.test.mjs cli/lib/fitnessSessionSummary.mjs
git commit -m "feat(cli): heal-fitness-sessions single-session heal (dry-run/apply)"
```

---

### Task 9: `--sweep` mode over all stored sessions

**Files:**
- Modify: `cli/heal-fitness-sessions.cli.mjs`
- Test: `cli/heal-fitness-sessions.test.mjs` (extend — a temp history dir with 2 sessions, one needing heal)

**Interfaces:**
- Consumes: `planHeal` in a scan loop; `needsHeal` gates reporting.
- Produces: `--sweep [--since Nd] [--apply]` — iterate `history/fitness/<date>/*.yml`, `planHeal` each, print a table of `{date, sessionId, removed[], merges[]}` for those with `needsHeal`, and heal them when `--apply`.

- [ ] **Step 1: Write the failing test** — temp history with `2026-06-27/<golden>.yml` (needs heal) + a clean session; assert sweep dry-run reports exactly the golden id and leaves files unchanged; `--apply` heals only the golden.

- [ ] **Step 2: Run to verify it fails.** → FAIL.

- [ ] **Step 3: Implement** — glob date dirs (respect `--since Nd` by comparing dir date to a cutoff computed from an injected "now" arg for testability), read each YAML, `planHeal`, collect candidates, print report; when `--apply`, call `heal(date, id, { apply:true })` per candidate. Print a final summary count.

- [ ] **Step 4: Run to verify it passes.** → PASS.

- [ ] **Step 5: Live dry-run (report only, no writes)** inside the container:
```bash
sudo docker exec daylight-station sh -c 'node cli/heal-fitness-sessions.cli.mjs --sweep --since 400d'
```
Expected: `20260627195941` listed among sessions needing heal (with `removed: [elizabeth, soren]`). Do NOT `--apply` yet — review the report first.

- [ ] **Step 6: Commit**

```bash
git add cli/heal-fitness-sessions.cli.mjs cli/heal-fitness-sessions.test.mjs
git commit -m "feat(cli): heal-fitness-sessions --sweep over stored sessions"
```

---

## Self-Review

**Spec coverage:**
- Capability A (known-user device merge) → Task 3 (`applyKnownUserDeviceMerge`), Task 4 (apply), Task 6 (backend).
- Capability B (effort-based absorb) → Task 1 (effort/insignificance), Task 3 (`applyEffortAbsorb`), Task 6 (backend).
- Plumbing fix 1 (close superseded entity) → Task 5.
- Plumbing fix 2 (series-only names visible) → Task 2 (`buildOccupancySegments`), Task 6 (occupant discovery from series).
- Plumbing fix 3 (effort not duration) → Task 1/3.
- Retroactive heal → Task 8; sweep → Task 9; parity → Task 7.
- Config `insignificant_usage` → Task 1 defaults, Task 4 wiring.

**Type consistency:** `runSessionBackfill` returns `{ perDevice, transfers, merges, keptOccupants, removedOccupants }` (Task 3) and every consumer (Task 4) reads `transfers`, `merges`, `removedOccupants`. `computeOccupantEffort` returns `{ coins, activeWarmZoneSeconds, hrSampleCount }` used identically by `isInsignificantEffort` (Task 1), `buildOccupancySegments` (Task 2), and backend `occupantEffort` (Task 6). Merge reason string `'known-user-device-swap'` matches between Task 3 impl and test.

**Open verification during execution:**
- Confirm `session.closeEntity` exists or add it (Task 5 Step 3).
- Confirm `FitnessContext` config field names `governance.insignificant_usage` / `known_user_aliases` against `fitness.yml` (Task 4 Step 5) — add to config if absent.
- Confirm on-disk metric names (`hr`/`zone`/`coins`) vs the serializer output for the sweep (Task 6/8) against the real fixture (Task 7).
