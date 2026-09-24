# Fitness Stint Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mid-session HR-strap reassignment moves one stint's data completely and consistently, every assignment leaves a stint record, save-time reconciliation honours relabels, and past sessions damaged by the old transfer are healed.

**Architecture:** A pure `stintTransfer.js` moves a stint's timeline cells (point series by cell, cumulative series by increment). `FitnessSession.reassignStint` orchestrates it plus three store-level stint moves (TreasureBox rings, TimelineRecorder beats, ActivityMonitor periods) and relabels the `SessionEntity` in place. `GuestAssignmentService` classifies correction vs handover and delegates. Save-time `sessionBackfill` treats relabelled stints as honoured; `PersistenceManager` derives participant flags from the configured directory and flattens any cumulative regression. The backend `SessionIdentityHealer` gains a split-repair pass; the heal CLI patches `summary.participants` instead of rebuilding the summary with the pre-rename builder.

**Tech Stack:** Plain ES modules (frontend `hooks/fitness`, backend `2_domains/fitness`), vitest (`npm run test:unit:vitest`), Playwright flow tests, js-yaml.

**Spec:** `docs/superpowers/specs/2026-09-23-fitness-stint-attribution-design.md`

## Global Constraints

- Correction = reassignment inside `governance.usage_threshold_seconds` (existing `isSegmentAbsorbed`); handover = outside it.
- Every transfer is a stint **delta**, never a copy of a total; per-person cumulative series never decrease; the sum of `totalRings` across people is unchanged by a reassignment.
- Pressure-mat per-user totals are not touched.
- No HR-pattern identity inference.
- Logging via `getLogger()` structured events only (no new raw `console.*`).
- Docs contain no hostnames/ports/real child names; fixtures are scrubbed (`kid-a`, `kid-b`, `guest-c`, `kid-d`, `kid-e`, `parent`).
- Sessions saved before this change (no stint fields) must load and reconcile exactly as today.

## Review Focus

1. **Correction onto a person who is simultaneously on another strap** — their own cells must win; rings/beats add, never overwrite. (Task 2 test `destination with own concurrent data keeps its cells`.)
2. **Correction before the session has started** (assignment made while no timeline exists) — must not throw; the stint opens at `ensureStarted` with `startTick: 0`. (Task 4 test `pre-session correction is a no-op on data and opens a stint at start`.)
3. **Chain of corrections on one strap** (A→B→A) — the second correction must move the whole stint from its original `startTick`, and `relabeledFrom` records both names in order. (Task 4 replay test.)
4. **Heal run twice** — second run finds nothing (idempotent). (Task 6 test `heal is idempotent`.)
5. **Heal on a modern session must not zero rings** — the old CLI summary builder reads `:coins`; patching must read `:rings`. (Task 6 test `patched summary keeps rings`.)

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/hooks/fitness/stintTransfer.js` (new) | Pure: move a stint window of `user:<from>:*` cells to `user:<to>:*`. |
| `frontend/src/hooks/fitness/SessionEntity.js` | Stint record: `startTick`, `endReason`, `relabeledFrom`, `relabel()`; drop `rings`. |
| `frontend/src/hooks/fitness/TreasureBox.js` | `moveStint(from,to,{baseRings})`; delete `transferAccumulator`, `renameUser`. |
| `frontend/src/hooks/fitness/TimelineRecorder.js` | `moveStintBeats(from,to,baseBeats)`; delete `transferCumulativeMetrics`. |
| `frontend/src/modules/Fitness/domain/ActivityMonitor.js` | `moveStintActivity(from,to,startTick)`; delete `transferActivity`. |
| `frontend/src/hooks/fitness/ZoneProfileStore.js` | `resetZoneState(userId)`. |
| `frontend/src/hooks/fitness/FitnessSession.js` | `openStint`, `reassignStint`, `_moveStintData`; auto-assign + `ensureStarted` open stints; delete `transferUserSeries`, `transferSessionEntity`. |
| `frontend/src/hooks/fitness/FitnessTimeline.js` | Delete `transferUserSeries`, `transferEntitySeries`. |
| `frontend/src/hooks/fitness/GuestAssignmentService.js` | Classify + delegate to `reassignStint` / `openStint`. |
| `frontend/src/hooks/fitness/ParticipantRoster.js` | Zone lookup keyed by userId; drop dead `_session` read. |
| `frontend/src/hooks/fitness/sessionBackfill.js` | Relabelled stints honoured; relabelled-away occupants removed. |
| `frontend/src/hooks/fitness/cumulativeGuard.js` (new) | Pure: flatten + report cumulative regressions. |
| `frontend/src/hooks/fitness/PersistenceManager.js` | Participant directory flags, stint-based roster augment, stint fields persisted, guard applied. |
| `frontend/src/context/FitnessContext.jsx` | Inject participant directory; expose `window.__fitnessAssignGuest` next to the sim controller. |
| `backend/src/2_domains/fitness/services/CumulativeSplitRepair.mjs` (new) | Pure: pair drop/jump splits and cancel them. |
| `backend/src/2_domains/fitness/services/SessionIdentityHealer.mjs` | Relabelled stints honoured; report split repairs. |
| `cli/lib/fitness/heal.mjs` | Apply split repairs; participant flags from config; patch `summary.participants`. |
| `backend/src/2_domains/fitness/services/__fixtures__/session-20260923183528.yml` (new) | Scrubbed golden fixture. |
| `tests/live/flow/fitness/guest-reassign-chart.runtime.test.mjs` (new) | Rendered chart through a reassignment chain. |

---

### Task 1: Stint record

**Files:**
- Modify: `frontend/src/hooks/fitness/SessionEntity.js`
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js` (entities mapping, ~line 1190)
- Test: `frontend/src/hooks/fitness/SessionEntity.stint.test.js` (new)

**Interfaces:**
- Produces: `new SessionEntity({ profileId, name, deviceId, startTime, startTick })`; `entity.relabel({ profileId, name })`; `entity.end({ status, timestamp, reason })` sets `endReason = reason`; `entity.summary` → `{ entityId, profileId, name, deviceId, startTime, endTime, startTick, status, endReason, relabeledFrom }`; `SessionEntityRegistry#relabel(entityId, { profileId, name })` → entity.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { SessionEntity, SessionEntityRegistry } from './SessionEntity.js';

describe('SessionEntity as a stint record', () => {
  it('carries startTick and an empty relabel history', () => {
    const e = new SessionEntity({ profileId: 'kid-a', name: 'Kid A', deviceId: 'D2', startTime: 1000, startTick: 139 });
    expect(e.startTick).toBe(139);
    expect(e.relabeledFrom).toEqual([]);
    expect(e.summary).not.toHaveProperty('rings');
  });

  it('relabel keeps the stint open and records prior occupants in order', () => {
    const reg = new SessionEntityRegistry();
    const e = reg.create({ profileId: 'kid-a', name: 'Kid A', deviceId: 'D2', startTime: 1000, startTick: 139 });
    reg.relabel(e.entityId, { profileId: 'kid-b', name: 'Kid B' });
    reg.relabel(e.entityId, { profileId: 'kid-a', name: 'Kid A' });
    expect(e.status).toBe('active');
    expect(e.profileId).toBe('kid-a');
    expect(e.relabeledFrom).toEqual(['kid-a', 'kid-b']);
    expect(reg.getByDevice('D2')).toBe(e);
  });

  it('end records the reason', () => {
    const e = new SessionEntity({ profileId: 'kid-a', deviceId: 'D2', startTime: 1000, startTick: 0 });
    e.end({ status: 'superseded', timestamp: 2000, reason: 'handover' });
    expect(e.summary).toMatchObject({ status: 'superseded', endTime: 2000, endReason: 'handover' });
  });

  it('round-trips through JSON', () => {
    const e = new SessionEntity({ profileId: 'kid-a', deviceId: 'D2', startTime: 1000, startTick: 5 });
    e.relabel({ profileId: 'kid-b', name: 'Kid B' });
    const back = SessionEntity.fromJSON(JSON.parse(JSON.stringify(e.toJSON())));
    expect(back.startTick).toBe(5);
    expect(back.relabeledFrom).toEqual(['kid-a']);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run frontend/src/hooks/fitness/SessionEntity.stint.test.js` — expect FAIL (`relabel` not a function / `startTick` undefined).

- [ ] **Step 3: Implement** in `SessionEntity.js`: constructor adds `this.startTick = Number.isFinite(startTick) ? startTick : null; this.endReason = null; this.relabeledFrom = [];` and removes `this.rings`, `cumulativeData`, `setRings`, `addRings`. `end()` sets `this.endReason = reason || null` (keep `transferReason` assignment for back-compat readers). Add:

```js
  relabel({ profileId, name } = {}) {
    if (!profileId || profileId === this.profileId) return this;
    if (this.profileId) this.relabeledFrom.push(this.profileId);
    this.profileId = profileId;
    if (name) this.name = name;
    return this;
  }
```

`summary`/`toJSON` emit `startTick`, `endReason`, `relabeledFrom` (copy) and drop `rings`/`cumulativeData`; `fromJSON` restores them (`relabeledFrom: Array.isArray(d.relabeledFrom) ? [...d.relabeledFrom] : []`). Registry:

```js
  relabel(entityId, { profileId, name } = {}) {
    const entity = this.entities.get(entityId);
    if (!entity) return null;
    return entity.relabel({ profileId, name });
  }
```

`PersistenceManager` entities mapping becomes:

```js
        return {
          entityId: entity.entityId || null,
          profileId: entity.profileId || null,
          deviceId: entity.deviceId || null,
          startTime: entity.startTime || null,
          endTime: entity.endTime || null,
          status: entity.status || 'active',
          ...(Number.isFinite(entity.startTick) ? { startTick: entity.startTick } : {}),
          ...(entity.endReason ? { endReason: entity.endReason } : {}),
          ...(Array.isArray(entity.relabeledFrom) && entity.relabeledFrom.length ? { relabeledFrom: [...entity.relabeledFrom] } : {})
        };
```

Grep for `setRings(`, `.addRings(`, `entity.rings`, `finalRings` and remove/adjust each caller (the entity-transfer path in `FitnessSession.transferSessionEntity` is deleted in Task 4 — leave it compiling for now by guarding `fromEntity.setRings?.(...)`).

- [ ] **Step 4: Run** the new test plus `npx vitest run frontend/src/hooks/fitness/` — expect PASS (fix any test asserting `rings` on an entity summary by removing that assertion).

- [ ] **Step 5: Commit** `git add frontend/src/hooks/fitness/SessionEntity.js frontend/src/hooks/fitness/SessionEntity.stint.test.js frontend/src/hooks/fitness/PersistenceManager.js && git commit -m "feat(fitness): SessionEntity becomes a stint record (startTick, endReason, relabel)"`

---

### Task 2: Pure stint series transfer

**Files:**
- Create: `frontend/src/hooks/fitness/stintTransfer.js`
- Test: `frontend/src/hooks/fitness/stintTransfer.test.js`

**Interfaces:**
- Produces: `moveStintSeries(series, { fromUserId, toUserId, startIndex }) → { movedKeys: string[], bases: { rings_total: number, heart_beats: number } }`. Mutates `series` (the live `FitnessTimeline.series` object, keys `user:<id>:<metric>`). `bases` = the source's cumulative value just before `startIndex` (0 if none). Exports `POINT_METRICS`, `CUMULATIVE_METRICS`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { moveStintSeries } from './stintTransfer.js';

const S = (o) => JSON.parse(JSON.stringify(o));

describe('moveStintSeries', () => {
  it('moves point cells in the window and blanks the source', () => {
    const series = S({ 'user:a:heart_rate': [90, 91, 120, 130], 'user:a:zone_id': ['cool', 'cool', 'warm', 'hot'] });
    moveStintSeries(series, { fromUserId: 'a', toUserId: 'b', startIndex: 2 });
    expect(series['user:a:heart_rate']).toEqual([90, 91, null, null]);
    expect(series['user:b:heart_rate']).toEqual([null, null, 120, 130]);
    expect(series['user:b:zone_id']).toEqual([null, null, 'warm', 'hot']);
  });

  it('moves cumulative increments, flattening the source at its base', () => {
    const series = S({ 'user:a:rings_total': [0, 2, 5, 9], 'user:b:rings_total': [0, 1, 1, 1] });
    const { bases } = moveStintSeries(series, { fromUserId: 'a', toUserId: 'b', startIndex: 2 });
    expect(bases.rings_total).toBe(2);
    expect(series['user:a:rings_total']).toEqual([0, 2, 2, 2]);
    expect(series['user:b:rings_total']).toEqual([0, 1, 4, 8]);
  });

  it('never produces a decreasing destination when it had no prior series', () => {
    const series = S({ 'user:a:rings_total': [0, 40, 88, 88] });
    moveStintSeries(series, { fromUserId: 'a', toUserId: 'b', startIndex: 1 });
    expect(series['user:b:rings_total']).toEqual([null, 40, 88, 88]);
    expect(series['user:a:rings_total']).toEqual([0, 0, 0, 0]);
  });

  it('destination with own concurrent data keeps its cells', () => {
    const series = S({ 'user:a:heart_rate': [null, 120, 121], 'user:b:heart_rate': [100, 101, null] });
    moveStintSeries(series, { fromUserId: 'a', toUserId: 'b', startIndex: 1 });
    expect(series['user:b:heart_rate']).toEqual([100, 101, 121]);
  });

  it('leaves non-person metrics (mat steps) alone', () => {
    const series = S({ 'user:a:steps_total': [1, 2, 3] });
    moveStintSeries(series, { fromUserId: 'a', toUserId: 'b', startIndex: 0 });
    expect(series['user:a:steps_total']).toEqual([1, 2, 3]);
    expect(series['user:b:steps_total']).toBeUndefined();
  });

  it('is a no-op for identical or missing ids', () => {
    const series = S({ 'user:a:heart_rate': [1] });
    expect(moveStintSeries(series, { fromUserId: 'a', toUserId: 'a', startIndex: 0 }).movedKeys).toEqual([]);
    expect(moveStintSeries(series, { fromUserId: null, toUserId: 'b', startIndex: 0 }).movedKeys).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run frontend/src/hooks/fitness/stintTransfer.test.js` — expect FAIL (module missing).

- [ ] **Step 3: Implement** `stintTransfer.js`:

```js
/**
 * stintTransfer — move one stint's timeline cells from one person to another.
 *
 * A stint is one occupant on one strap from `startIndex` to "now". A
 * correction moves exactly that window; data before it stays with its owner.
 * Point series move cell-by-cell (destination keeps any cell it already has —
 * it can only have one if it was on a second strap). Cumulative series move by
 * INCREMENT: the source flattens at its pre-stint value, the destination adds
 * the stint's increments on top of its own running total. Neither line can
 * drop or jump.
 */
export const POINT_METRICS = new Set(['heart_rate', 'zone_id', 'rpm', 'power', 'distance']);
export const CUMULATIVE_METRICS = new Set(['rings_total', 'heart_beats']);

const lastFiniteBefore = (arr, idx) => {
  for (let i = Math.min(idx, arr.length) - 1; i >= 0; i -= 1) {
    if (Number.isFinite(arr[i])) return arr[i];
  }
  return null;
};

export function moveStintSeries(series, { fromUserId, toUserId, startIndex = 0 } = {}) {
  const result = { movedKeys: [], bases: { rings_total: 0, heart_beats: 0 } };
  if (!series || typeof series !== 'object') return result;
  if (!fromUserId || !toUserId || fromUserId === toUserId) return result;
  const start = Math.max(0, Number.isFinite(startIndex) ? Math.floor(startIndex) : 0);
  const fromPrefix = `user:${fromUserId}:`;

  for (const key of Object.keys(series)) {
    if (!key.startsWith(fromPrefix)) continue;
    const metric = key.slice(fromPrefix.length);
    const isPoint = POINT_METRICS.has(metric);
    const isCumulative = CUMULATIVE_METRICS.has(metric);
    if (!isPoint && !isCumulative) continue;
    const fromArr = series[key];
    if (!Array.isArray(fromArr)) continue;
    const toKey = `user:${toUserId}:${metric}`;
    const toOrig = Array.isArray(series[toKey]) ? [...series[toKey]] : [];
    const len = Math.max(fromArr.length, toOrig.length);
    const toArr = Array.from({ length: len }, (_, i) => (i < toOrig.length ? toOrig[i] : null));

    if (isPoint) {
      for (let i = start; i < fromArr.length; i += 1) {
        if (fromArr[i] == null) continue;
        if (toArr[i] == null) toArr[i] = fromArr[i];
        fromArr[i] = null;
      }
    } else {
      const fromBase = lastFiniteBefore(fromArr, start) ?? 0;
      result.bases[metric] = fromBase;
      let toOwn = lastFiniteBefore(toOrig, start);
      for (let i = start; i < len; i += 1) {
        if (Number.isFinite(toOrig[i])) toOwn = toOrig[i];
        const fromVal = i < fromArr.length ? fromArr[i] : null;
        if (!Number.isFinite(fromVal)) continue;
        const inc = Math.max(0, fromVal - fromBase);
        toArr[i] = (toOwn ?? 0) + inc;
        fromArr[i] = fromBase;
      }
    }
    series[toKey] = toArr;
    result.movedKeys.push(key);
  }
  return result;
}

export default moveStintSeries;
```

Note the third test: `user:a:rings_total` index 0 is before the window so stays 0, then flattened to base 0.

- [ ] **Step 4: Run** the test — expect PASS.
- [ ] **Step 5: Commit** `git add frontend/src/hooks/fitness/stintTransfer.js frontend/src/hooks/fitness/stintTransfer.test.js && git commit -m "feat(fitness): pure stint window transfer for timeline series"`

---

### Task 3: Store-level stint moves

**Files:**
- Modify: `frontend/src/hooks/fitness/TreasureBox.js` (replace `transferAccumulator` ~line 260-273, delete `renameUser` ~305-316)
- Modify: `frontend/src/hooks/fitness/TimelineRecorder.js` (replace `transferCumulativeMetrics` ~line 605-630)
- Modify: `frontend/src/modules/Fitness/domain/ActivityMonitor.js` (replace `transferActivity` ~line 190-230)
- Modify: `frontend/src/hooks/fitness/ZoneProfileStore.js`
- Test: `frontend/src/hooks/fitness/stintStores.test.js` (new)

**Interfaces:**
- Produces: `treasureBox.moveStint(fromUserId, toUserId, { baseRings }) → number` (rings moved); `timelineRecorder.moveStintBeats(fromUserId, toUserId, baseBeats) → number`; `activityMonitor.moveStintActivity(fromId, toId, startTick) → void`; `zoneProfileStore.resetZoneState(userId) → void`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { FitnessTreasureBox } from './TreasureBox.js';
import { TimelineRecorder } from './TimelineRecorder.js';
import { ActivityMonitor } from '../../modules/Fitness/domain/ActivityMonitor.js';
import { ParticipantStatus } from '../../modules/Fitness/domain/types.js';

describe('TreasureBox.moveStint', () => {
  it('moves only the stint delta and conserves the total', () => {
    const tb = new FitnessTreasureBox(null);
    tb.perUser.set('a', { ...tb._createAccumulator(1), profileId: 'a', totalRings: 90, highestZone: { id: 'warm', min: 140 }, lastHR: 150, _lastHRTimestamp: Date.now() });
    tb.perUser.set('b', { ...tb._createAccumulator(1), profileId: 'b', totalRings: 5 });
    const moved = tb.moveStint('a', 'b', { baseRings: 2 });
    expect(moved).toBe(88);
    expect(tb.perUser.get('a').totalRings).toBe(2);
    expect(tb.perUser.get('b').totalRings).toBe(93);
    expect(tb.perUser.get('b').highestZone?.id).toBe('warm');
    expect(tb.perUser.get('a').highestZone).toBeNull();
  });

  it('creates the destination accumulator when missing', () => {
    const tb = new FitnessTreasureBox(null);
    tb.perUser.set('a', { ...tb._createAccumulator(1), profileId: 'a', totalRings: 10 });
    expect(tb.moveStint('a', 'b', { baseRings: 0 })).toBe(10);
    expect(tb.perUser.get('b').profileId).toBe('b');
  });

  it('has no transferAccumulator stub any more', () => {
    expect(FitnessTreasureBox.prototype.transferAccumulator).toBeUndefined();
  });
});

describe('TimelineRecorder.moveStintBeats', () => {
  it('moves the beats delta', () => {
    const r = new TimelineRecorder();
    r._cumulativeBeats.set('a', 586.4);
    r._cumulativeBeats.set('b', 20.3);
    expect(r.moveStintBeats('a', 'b', 0)).toBeCloseTo(586.4);
    expect(r._cumulativeBeats.get('a')).toBe(0);
    expect(r._cumulativeBeats.get('b')).toBeCloseTo(606.7);
  });
});

describe('ActivityMonitor.moveStintActivity', () => {
  it('splits a straddling period at startTick and hands the tail to the destination', () => {
    const m = new ActivityMonitor();
    for (let t = 0; t <= 10; t += 1) m.recordTick(t, new Set(['a']));
    m.moveStintActivity('a', 'b', 6);
    expect(m.getActivityMask('a', 10).slice(0, 6).every(Boolean)).toBe(true);
    expect(m.getActivityMask('a', 10).slice(6).some(Boolean)).toBe(false);
    expect(m.getActivityMask('b', 10).slice(6).every(Boolean)).toBe(true);
    expect(m.isActive('b')).toBe(true);
    expect(m.getStatus('a')).toBe(ParticipantStatus.IDLE);
  });

  it('forgets the source entirely when all its activity moved', () => {
    const m = new ActivityMonitor();
    for (let t = 3; t <= 5; t += 1) m.recordTick(t, new Set(['a']));
    m.moveStintActivity('a', 'b', 3);
    expect(m.getActivityMask('a', 5).some(Boolean)).toBe(false);
    expect(m.wasActiveLastTick('b')).toBe(true);
    expect(m.wasActiveLastTick('a')).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run frontend/src/hooks/fitness/stintStores.test.js` — expect FAIL.

- [ ] **Step 3: Implement.** TreasureBox (replace `transferAccumulator`, delete `renameUser`):

```js
  /**
   * Move one stint's rings from one person to another (a correction).
   * `baseRings` is the source's total just before the stint began; everything
   * above it was earned on the strap being relabelled. The in-flight interval
   * (highest zone so far, last HR) belongs to whoever is wearing that strap, so
   * it moves too — unless the destination is broadcasting on another strap.
   * @returns {number} rings moved
   */
  moveStint(fromUserId, toUserId, { baseRings = 0 } = {}) {
    if (!fromUserId || !toUserId || fromUserId === toUserId) return 0;
    const from = this.perUser.get(fromUserId);
    if (!from) return 0;
    const now = Date.now();
    const base = Number.isFinite(baseRings) ? Math.max(0, baseRings) : 0;
    const delta = Math.max(0, (from.totalRings || 0) - base);
    let to = this.perUser.get(toUserId);
    if (!to) {
      to = this._createAccumulator(now);
      to.profileId = toUserId;
      this.perUser.set(toUserId, to);
    }
    to.totalRings = (to.totalRings || 0) + delta;
    from.totalRings = (from.totalRings || 0) - delta;
    const toBroadcasting = Number.isFinite(to._lastHRTimestamp) && (now - to._lastHRTimestamp) < this.ringTimeUnitMs * 2;
    if (!toBroadcasting) {
      to.currentIntervalStart = from.currentIntervalStart;
      to.highestZone = from.highestZone;
      to.lastHR = from.lastHR;
      to.currentColor = from.currentColor;
      to.lastColor = from.lastColor;
      to.lastZoneId = from.lastZoneId;
      to._lastHRTimestamp = from._lastHRTimestamp;
    }
    Object.assign(from, {
      currentIntervalStart: now, highestZone: null, lastHR: null,
      currentColor: NO_ZONE_LABEL, lastColor: NO_ZONE_LABEL, lastZoneId: null
    });
    this._log('stint_moved', { fromUserId, toUserId, baseRings: base, ringsMoved: delta }, 'info');
    this._notifyMutation();
    return delta;
  }
```

TimelineRecorder (replace `transferCumulativeMetrics`):

```js
  /**
   * Move one stint's heart beats (a correction). `baseBeats` is the source's
   * running total just before the stint began.
   * @returns {number} beats moved
   */
  moveStintBeats(fromUserId, toUserId, baseBeats = 0) {
    if (!fromUserId || !toUserId || fromUserId === toUserId) return 0;
    const fromTotal = this._cumulativeBeats.get(fromUserId);
    if (!Number.isFinite(fromTotal)) return 0;
    const base = Number.isFinite(baseBeats) ? Math.max(0, baseBeats) : 0;
    const delta = Math.max(0, fromTotal - base);
    this._cumulativeBeats.set(fromUserId, fromTotal - delta);
    this._cumulativeBeats.set(toUserId, (this._cumulativeBeats.get(toUserId) || 0) + delta);
    return delta;
  }
```

ActivityMonitor (replace `transferActivity`):

```js
  /**
   * Hand every activity period at or after `startTick` from one participant to
   * another (a stint correction). A period straddling `startTick` is split.
   */
  moveStintActivity(fromId, toId, startTick) {
    if (!fromId || !toId || fromId === toId || !Number.isFinite(startTick)) return;
    const kept = [];
    const moved = [];
    for (const p of this._activityHistory.get(fromId) || []) {
      if (p.endTick !== null && p.endTick < startTick) { kept.push(p); continue; }
      if (p.startTick >= startTick) { moved.push(p); continue; }
      kept.push({ ...p, endTick: startTick - 1 });
      moved.push({ ...p, startTick });
    }
    const movedDropouts = (this._dropoutEvents.get(fromId) || []).filter((e) => e.tick >= startTick);
    if (movedDropouts.length) {
      this._dropoutEvents.set(fromId, (this._dropoutEvents.get(fromId) || []).filter((e) => e.tick < startTick));
      const merged = [...(this._dropoutEvents.get(toId) || []), ...movedDropouts].sort((a, b) => a.tick - b.tick);
      this._dropoutEvents.set(toId, merged);
    }
    if (moved.length) {
      const merged = [...(this._activityHistory.get(toId) || []), ...moved].sort((a, b) => a.startTick - b.startTick);
      this._activityHistory.set(toId, merged);
    }
    const fromState = this._participants.get(fromId);
    if (fromState) {
      const toState = this._participants.get(toId);
      if (!toState || (fromState.lastActiveTick ?? -1) > (toState.lastActiveTick ?? -1)) {
        this._participants.set(toId, { ...fromState, participantId: toId, firstSeenTick: toState?.firstSeenTick ?? fromState.firstSeenTick });
      }
    }
    if (kept.length) {
      this._activityHistory.set(fromId, kept);
      if (fromState) {
        this._participants.set(fromId, { ...fromState, status: ParticipantStatus.IDLE, lastActiveTick: Math.min(fromState.lastActiveTick ?? -1, startTick - 1) });
      }
    } else {
      this._activityHistory.delete(fromId);
      this._participants.delete(fromId);
    }
    if (this._previousTickActive.has(fromId)) {
      this._previousTickActive.delete(fromId);
      this._previousTickActive.add(toId);
    }
  }
```

ZoneProfileStore:

```js
  /** Forget one user's smoothing state so a new wearer starts clean. */
  resetZoneState(userId) {
    if (userId == null) return;
    this._hysteresis.delete(String(userId));
  }
```

(Check the key type `_hysteresis` uses in `getZoneState`; match it.) Delete any test that exercised `transferAccumulator`, `renameUser`, `transferActivity` or `TimelineRecorder.transferCumulativeMetrics`; grep `frontend/src` for callers — only `FitnessSession` (Task 4) should remain; leave its calls guarded with `?.` until Task 4.

- [ ] **Step 4: Run** `npx vitest run frontend/src/hooks/fitness/ frontend/src/modules/Fitness/domain/` — expect PASS.
- [ ] **Step 5: Commit** `git add -A frontend/src/hooks/fitness frontend/src/modules/Fitness/domain && git commit -m "feat(fitness): stint-scoped moves for rings, beats and activity"`

---

### Task 4: Session wiring — open stints, reassignStint, GuestAssignmentService

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js` (auto-assign ~line 509-525; `createSessionEntity` ~621; delete `transferSessionEntity` ~735-815 and `transferUserSeries` ~832-873; `ensureStarted` guest loop ~2066-2085)
- Modify: `frontend/src/hooks/fitness/FitnessTimeline.js` (delete `transferEntitySeries`, `transferUserSeries`)
- Modify: `frontend/src/hooks/fitness/GuestAssignmentService.js` (~line 142-300, `clearGuest`)
- Modify: `frontend/src/hooks/fitness/ParticipantRoster.js` (~line 595, 606)
- Test: `frontend/src/hooks/fitness/FitnessSession.reassignStint.test.js` (new); update `GuestAssignmentService.closeOnReassign.test.js`, `GuestAssignmentService.threshold.test.js`, `FitnessSession.assignmentDurability.test.js`

**Interfaces:**
- Consumes: Task 1 `SessionEntity`/`registry.relabel`; Task 2 `moveStintSeries`; Task 3 store moves.
- Produces: `session.openStint({ deviceId, profileId, name }) → SessionEntity|null`; `session.reassignStint(deviceId, toUserId, { mode: 'correction'|'handover', name }) → { ok, mode, stint, ringsMoved?, beatsMoved? }`.

- [ ] **Step 1: Write the failing test** `FitnessSession.reassignStint.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FitnessSession } from './FitnessSession.js';
import { DeviceAssignmentLedger } from './DeviceAssignmentLedger.js';
import { GuestAssignmentService } from './GuestAssignmentService.js';

const ZONES = [
  { id: 'cool', name: 'Cool', min: 0, color: 'blue', rings: 0 },
  { id: 'active', name: 'Active', min: 100, color: 'green', rings: 1 },
  { id: 'warm', name: 'Warm', min: 130, color: 'yellow', rings: 2 },
];
const hr = (deviceId, bpm) => ({ topic: 'fitness', type: 'ant', deviceId, profile: 'HR', data: { ComputedHeartRate: bpm } });

function build() {
  const session = new FitnessSession();
  const ledger = new DeviceAssignmentLedger();
  session.userManager.setAssignmentLedger(ledger);
  session.userManager.configure({
    primary: [
      { id: 'kid-a', name: 'Kid A', hr_device_id: 'D2' },
      { id: 'kid-d', name: 'Kid D', hr_device_id: 'D1' },
      { id: 'kid-e', name: 'Kid E', hr_device_id: 'D3' },
    ],
    friends: [{ id: 'kid-b', name: 'Kid B' }, { id: 'guest-c', name: 'Guest C' }],
  }, ZONES);
  session.ensureStarted({ force: true, reason: 'reassign-test' });
  session.zoneProfileStore.setBaseZoneConfig(ZONES);
  session.treasureBox.configure({ zones: ZONES });
  const svc = new GuestAssignmentService({ session, ledger, thresholdMs: 300_000 });
  return { session, svc };
}

// One 5s tick: every listed device sends a packet, then the timeline ticks.
function tick(session, readings) {
  vi.advanceTimersByTime(5000);
  for (const [dev, bpm] of Object.entries(readings)) session.ingestData(hr(dev, bpm));
  session._collectTimelineTick();
}
const series = (session, id, metric) => session.timeline.series[`user:${id}:${metric}`] || [];
const nonDecreasing = (arr) => arr.every((v, i) => i === 0 || v == null || arr.slice(0, i).filter(Number.isFinite).every((p) => v >= p));

describe('FitnessSession.reassignStint', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_790_213_728_000); });
  afterEach(() => { vi.useRealTimers(); });

  it('correction into a person who already has rings moves only the stint and conserves rings', () => {
    const { session, svc } = build();
    for (let i = 0; i < 12; i += 1) tick(session, { D2: 140, D1: 140 });
    const before = [...session.treasureBox.perUser.values()].reduce((s, a) => s + a.totalRings, 0);
    svc.assignGuest('D2', { name: 'Kid D', profileId: 'kid-d', allowWhileAssigned: true });
    const after = [...session.treasureBox.perUser.values()].reduce((s, a) => s + a.totalRings, 0);
    expect(after).toBe(before);
    for (let i = 0; i < 6; i += 1) tick(session, { D2: 140, D1: 140 });
    expect(nonDecreasing(series(session, 'kid-d', 'rings_total'))).toBe(true);
    expect(nonDecreasing(series(session, 'kid-a', 'rings_total'))).toBe(true);
    session.reset();
  });

  it('handover moves nothing and closes the stint', () => {
    const { session, svc } = build();
    for (let i = 0; i < 4; i += 1) tick(session, { D2: 140 });
    vi.advanceTimersByTime(301_000);
    for (let i = 0; i < 2; i += 1) tick(session, { D2: 140 });
    const aRings = session.treasureBox.perUser.get('kid-a').totalRings;
    svc.assignGuest('D2', { name: 'Kid B', profileId: 'kid-b' });
    expect(session.treasureBox.perUser.get('kid-a').totalRings).toBe(aRings);
    const stints = session.entityRegistry.getAll().filter((e) => e.deviceId === 'D2');
    expect(stints.map((e) => [e.profileId, e.status, e.endReason])).toEqual([
      ['kid-a', 'superseded', 'handover'],
      ['kid-b', 'active', null],
    ]);
    session.reset();
  });

  it('replays the motivating chain: D1 kid-d→guest-c, D2 kid-a→kid-b→kid-a, D3 kid-e→kid-b', () => {
    const { session, svc } = build();
    for (let i = 0; i < 3; i += 1) tick(session, { D1: 95 });
    svc.assignGuest('D1', { name: 'Guest C', profileId: 'guest-c' });
    for (let i = 0; i < 3; i += 1) tick(session, { D1: 150, D2: 150 });
    svc.assignGuest('D2', { name: 'Kid B', profileId: 'kid-b' });
    for (let i = 0; i < 48; i += 1) tick(session, { D1: 150, D2: 150 });
    const ringsOnD2 = session.treasureBox.perUser.get('kid-b').totalRings;
    expect(ringsOnD2).toBeGreaterThan(0);
    svc.assignGuest('D2', { name: 'Kid A', profileId: 'kid-a' });
    tick(session, { D1: 150, D2: 150, D3: 120 });
    svc.assignGuest('D3', { name: 'Kid B', profileId: 'kid-b' });
    for (let i = 0; i < 20; i += 1) tick(session, { D1: 150, D2: 150, D3: 120 });

    for (const id of ['kid-a', 'kid-b', 'guest-c', 'kid-d', 'kid-e']) {
      expect(nonDecreasing(series(session, id, 'rings_total'))).toBe(true);
      expect(nonDecreasing(series(session, id, 'heart_beats'))).toBe(true);
    }
    // kid-a got the whole D2 stint; kid-b kept none of it.
    expect(session.treasureBox.perUser.get('kid-a').totalRings).toBeGreaterThanOrEqual(ringsOnD2);
    expect(session.treasureBox.perUser.get('kid-b').totalRings).toBeLessThan(ringsOnD2);
    const byDevice = Object.fromEntries(session.entityRegistry.getAll().map((e) => [e.deviceId, e]));
    expect(byDevice.D2.profileId).toBe('kid-a');
    expect(byDevice.D2.relabeledFrom).toEqual(['kid-a', 'kid-b']);
    expect(byDevice.D1.relabeledFrom).toEqual(['kid-d']);
    expect(byDevice.D3.relabeledFrom).toEqual(['kid-e']);
    session.reset();
  });

  it('pre-session correction is a no-op on data and opens a stint at start', () => {
    const session = new FitnessSession();
    const ledger = new DeviceAssignmentLedger();
    session.userManager.setAssignmentLedger(ledger);
    session.userManager.configure({ primary: [{ id: 'kid-a', name: 'Kid A', hr_device_id: 'D2' }] }, ZONES);
    const svc = new GuestAssignmentService({ session, ledger, thresholdMs: 300_000 });
    expect(() => svc.assignGuest('D2', { name: 'Kid B', profileId: 'kid-b' })).not.toThrow();
    session.ensureStarted({ force: true, reason: 'test' });
    const stint = session.entityRegistry.getByDevice('D2');
    expect(stint).toMatchObject({ profileId: 'kid-b', startTick: 0 });
    expect(ledger.get('D2').entityId).toBe(stint.entityId);
    session.reset();
  });

  it('auto-assigned member gets a stint', () => {
    const { session } = build();
    for (let i = 0; i < 5; i += 1) tick(session, { D2: 120 });
    expect(session.entityRegistry.getByDevice('D2')?.profileId).toBe('kid-a');
    session.reset();
  });

  it('removed transfer paths are gone', () => {
    expect(FitnessSession.prototype.transferUserSeries).toBeUndefined();
    expect(FitnessSession.prototype.transferSessionEntity).toBeUndefined();
  });
});
```

If the harness methods differ (e.g. `_collectTimelineTick` needs the tick timer), mirror `FitnessSession.tickStorm.test.js`'s setup; keep the assertions.

- [ ] **Step 2: Run** `npx vitest run frontend/src/hooks/fitness/FitnessSession.reassignStint.test.js` — expect FAIL.

- [ ] **Step 3: Implement in `FitnessSession.js`.**

`createSessionEntity` gains `startTick` and stops calling `treasureBox.initializeEntity` (keep `setActiveEntity`, debug-only):

```js
  createSessionEntity({ profileId, name, deviceId, startTime, startTick }) {
    const now = startTime || Date.now();
    const tick = Number.isFinite(startTick) ? startTick : (this.timeline?.timebase?.tickCount ?? 0);
    const entity = this.entityRegistry.create({ profileId, name, deviceId, startTime: now, startTick: tick });
    if (this.treasureBox && deviceId) this.treasureBox.setActiveEntity(deviceId, entity.entityId);
    this.eventJournal?.log('ENTITY_CREATED', { entityId: entity.entityId, profileId, name, deviceId, startTime: now, startTick: tick });
    return entity;
  }

  /**
   * Open the stint for a strap's current occupant. Idempotent for the same
   * occupant; a different occupant closes the open stint as a handover.
   * No-op before the session starts — ensureStarted opens stints then.
   */
  openStint({ deviceId, profileId, name } = {}) {
    if (!this.sessionId || deviceId == null || !profileId) return null;
    const open = this.entityRegistry.getByDevice(deviceId);
    if (open && open.status === 'active') {
      if (open.profileId === profileId) return open;
      this.entityRegistry.endEntity(open.entityId, { status: 'superseded', reason: 'handover' });
    }
    return this.createSessionEntity({ profileId, name: name || profileId, deviceId: String(deviceId) });
  }

  /**
   * Move a strap to a new occupant.
   *  - correction: the open stint's data (from its startTick) moves to the new
   *    person and the stint is relabelled in place.
   *  - handover: nothing moves; the stint closes and a new one opens.
   */
  reassignStint(deviceId, toUserId, { mode = 'handover', name } = {}) {
    const key = String(deviceId);
    const stint = this.entityRegistry.getByDevice(key);
    if (!this.sessionId || !stint || stint.status !== 'active') {
      return { ok: false, reason: 'no-open-stint', stint: this.openStint({ deviceId: key, profileId: toUserId, name }) };
    }
    const fromUserId = stint.profileId;
    if (fromUserId === toUserId) return { ok: true, mode: 'noop', stint };
    if (mode === 'correction') {
      const moved = this._moveStintData(fromUserId, toUserId, stint.startTick);
      this.entityRegistry.relabel(stint.entityId, { profileId: toUserId, name });
      const fromStillHasStint = this.entityRegistry.getByProfile(fromUserId).length > 0;
      if (!fromStillHasStint) this.markUserAsTransferred(fromUserId);
      getLogger().info('fitness.stint.corrected', { deviceId: key, fromUserId, toUserId, startTick: stint.startTick, ...moved });
      return { ok: true, mode, stint, ...moved };
    }
    this.entityRegistry.endEntity(stint.entityId, { status: 'superseded', reason: 'handover' });
    const next = this.createSessionEntity({ profileId: toUserId, name: name || toUserId, deviceId: key });
    getLogger().info('fitness.stint.handover', { deviceId: key, fromUserId, toUserId });
    return { ok: true, mode: 'handover', stint: next };
  }

  _moveStintData(fromUserId, toUserId, startTick) {
    const start = Number.isFinite(startTick) ? startTick : 0;
    const pruned = Number(this.timeline?.timebase?.prunedTickCount) || 0;
    let bases = { rings_total: 0, heart_beats: 0 };
    if (this.timeline?.series) {
      ({ bases } = moveStintSeries(this.timeline.series, { fromUserId, toUserId, startIndex: start - pruned }));
    }
    const ringsMoved = this.treasureBox?.moveStint(fromUserId, toUserId, { baseRings: bases.rings_total }) ?? 0;
    const beatsMoved = this._timelineRecorder?.moveStintBeats(fromUserId, toUserId, bases.heart_beats) ?? 0;
    this.activityMonitor?.moveStintActivity(fromUserId, toUserId, start);
    this.zoneProfileStore?.resetZoneState?.(toUserId);
    this._transferVersion = (this._transferVersion || 0) + 1;
    return { ringsMoved, beatsMoved };
  }
```

Import `moveStintSeries` from `./stintTransfer.js`. Delete `transferSessionEntity` and `transferUserSeries`. In the auto-assign branch of `recordDeviceActivity`, open the stint first and pass its id:

```js
          const stint = this.openStint({ deviceId: device.id, profileId: user.id, name: user.name });
          this.userManager.assignGuest(device.id, user.name, {
            name: user.name,
            profileId: user.id,
            source: user.source || 'auto',
            occupantType: user.source === 'Guest' ? 'guest' : 'member',
            ...(stint ? { entityId: stint.entityId } : {})
          });
```

In `ensureStarted`, replace the guest-only loop with every ledger entry (preserve the entry's own `occupantType`):

```js
    const ledgerAssignments = this.userManager?.assignmentLedger?.snapshot?.() || [];
    for (const assignment of ledgerAssignments) {
      if (!assignment?.deviceId) continue;
      const profileId = assignment.occupantId || assignment.metadata?.profileId;
      if (!profileId) continue;
      const entity = this.createSessionEntity({
        profileId,
        name: assignment.occupantName || assignment.metadata?.name || profileId,
        deviceId: assignment.deviceId,
        startTime: now,
        startTick: 0,
      });
      this.userManager.assignGuest(assignment.deviceId, assignment.occupantName, {
        ...(assignment.metadata || {}),
        profileId,
        occupantType: assignment.occupantType || 'member',
        entityId: entity.entityId,
      });
    }
```

In `FitnessTimeline.js` delete `transferEntitySeries` and `transferUserSeries`. In `ParticipantRoster.js` set `const trackingId = userId;` (was `entityId || userId`) and replace the `registryStartTime` line with `let entityStartTime = guestEntry?.updatedAt || null;`.

`GuestAssignmentService.assignGuest`: keep validation, the threshold classification and the `SEGMENT_ABSORBED` / `GUEST_REPLACED` logging, but replace everything from "Close-on-reassign" through the transfer branches with:

```js
    const mode = isSegmentAbsorbed ? 'correction' : 'handover';
    let stint = null;
    if (previousOccupantId && previousOccupantId !== newOccupantId && session.reassignStint) {
      stint = session.reassignStint(key, newOccupantId, { mode, name: value.name })?.stint || null;
    } else if (session.openStint) {
      stint = session.openStint({ deviceId: key, profileId: newOccupantId, name: value.name });
    }
    const entityId = stint?.entityId || null;
    getLogger().info('guest_assignment.assigned', { deviceId: key, from: previousOccupantId || null, to: newOccupantId, mode, entityId });
```

(Remove `transferredFromEntity`, `transferFromUserId`, `skipEntityCreation`, the `previousUserAccumulator` log field.) `clearGuest`: replace its entity-ending code with `session.entityRegistry?.getByDevice?.(key)` → `session.entityRegistry.endEntity(id, { status: 'ended', reason: 'cleared' })` if active.

Update `GuestAssignmentService.closeOnReassign.test.js` / `threshold.test.js` mocks: they now assert `session.reassignStint` is called with `mode: 'correction'` under threshold and `'handover'` over it, instead of `transferUserSeries`/`closeEntity`. Update `FitnessSession.assignmentDurability.test.js` "creates a fresh active entity for a guest" to also cover a member entry.

- [ ] **Step 4: Run** `npx vitest run frontend/src/hooks/fitness/ frontend/src/modules/Fitness/` — expect PASS. `grep -rn "transferUserSeries\|transferSessionEntity\|transferAccumulator\|transferActivity\|transferCumulativeMetrics" frontend/src --include=*.js --include=*.jsx` returns only `MetricsRecorder.js` (dead, untouched) — remove the `MetricsRecorder` call sites if any remain.
- [ ] **Step 5: Commit** `git add -A frontend/src && git commit -m "feat(fitness): reassignStint — corrections move one stint completely, every assignment is a stint"`

---

### Task 5: Save-time reconciliation and participant flags

**Files:**
- Modify: `frontend/src/hooks/fitness/sessionBackfill.js` (`buildSegmentsPerDevice`, `runSessionBackfill`)
- Create: `frontend/src/hooks/fitness/cumulativeGuard.js`
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js` (`buildParticipantsForPersist`, `_augmentRosterFromSeries`, save flow ~line 1087-1105, setters ~740)
- Modify: `frontend/src/context/FitnessContext.jsx` (~line 667)
- Test: `frontend/src/hooks/fitness/cumulativeGuard.test.js` (new); extend `sessionBackfill.golden.test.js`, `PersistenceManager.symmetricTransitions.test.js`

**Interfaces:**
- Produces: `flattenCumulativeRegressions(series) → Array<{ key, tick, drop }>` (mutates); `persistenceManager.setParticipantDirectory({ primaryIds: string[], names: Record<string,string> })`; segments carry `relabeled: boolean`.

- [ ] **Step 1: Write the failing tests.** `cumulativeGuard.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { flattenCumulativeRegressions } from './cumulativeGuard.js';

describe('flattenCumulativeRegressions', () => {
  it('flattens a dip and reports it', () => {
    const series = { 'user:a:rings_total': [0, 88, 1, 2, 90], 'user:a:heart_rate': [90, 80, 70, 60, 50] };
    const found = flattenCumulativeRegressions(series);
    expect(series['user:a:rings_total']).toEqual([0, 88, 88, 88, 90]);
    expect(series['user:a:heart_rate']).toEqual([90, 80, 70, 60, 50]);
    expect(found).toEqual([{ key: 'user:a:rings_total', tick: 2, drop: 87 }]);
  });
  it('ignores nulls and clean series', () => {
    const series = { 'user:a:heart_beats': [null, 1, null, 3], 'global:rings_total': [0, 1, 2] };
    expect(flattenCumulativeRegressions(series)).toEqual([]);
  });
});
```

Add to `sessionBackfill.golden.test.js`:

```js
  it('honours a relabelled stint even with high effort and drops relabelled-away names', () => {
    const series = {
      'user:kid-a:heart_rate': [150, 150, 150], 'user:kid-a:rings_total': [0, 44, 88], 'user:kid-a:zone_id': ['warm', 'warm', 'warm'],
      'user:kid-b:heart_rate': [null, null, null], 'user:kid-b:rings_total': [0, 0, 0],
      'user:kid-d:heart_rate': [null, null, null], 'user:kid-d:rings_total': [0, 0, 0],
    };
    const entities = [
      { entityId: 'e2', profileId: 'kid-a', deviceId: 'D2', startTime: 1000, endTime: null, status: 'active', startTick: 0, relabeledFrom: ['kid-a', 'kid-b'] },
      { entityId: 'e1', profileId: 'guest-c', deviceId: 'D1', startTime: 1000, endTime: null, status: 'active', startTick: 0, relabeledFrom: ['kid-d'] },
    ];
    const r = runSessionBackfill({ entities, series, thresholdMs: 300000, sessionEndTime: 99999 });
    expect(r.removedOccupants.has('kid-a')).toBe(false);
    expect(r.removedOccupants.has('kid-b')).toBe(true);
    expect(r.removedOccupants.has('kid-d')).toBe(true);
    expect(r.transfers.find((t) => t.fromOccupantId === 'kid-a')).toBeUndefined();
  });
```

Add to `PersistenceManager.symmetricTransitions.test.js` (use that file's existing save harness to capture the payload):

```js
  it('derives participant flags from the configured directory', async () => {
    // arrange a roster with kid-a (primary, ledger said guest), kid-b (friend), parent (primary)
    pm.setParticipantDirectory({ primaryIds: ['kid-a', 'parent'], names: { 'kid-a': 'Kid A', parent: 'Parent', 'kid-b': 'Kid B' } });
    // ... save through the harness ...
    expect(payload.participants['kid-a']).toMatchObject({ display_name: 'Kid A', is_primary: true });
    expect(payload.participants['kid-a']).not.toHaveProperty('is_guest');
    expect(payload.participants['kid-a']).not.toHaveProperty('base_user');
    expect(payload.participants['kid-b']).toMatchObject({ display_name: 'Kid B', is_guest: true });
    expect(payload.participants['kid-b']).not.toHaveProperty('is_primary');
  });
```

(Fill the arrange/save lines by copying the nearest existing test in that file.)

- [ ] **Step 2: Run** the three files — expect FAIL.

- [ ] **Step 3: Implement.** `cumulativeGuard.js`:

```js
/**
 * A cumulative series (rings, beats, rotations) can only grow. If one ever
 * dips, something upstream moved data without its running counter — flatten
 * the dip so the saved file and every chart stay monotonic, and report it so
 * the cause is visible in the log store instead of on a chart.
 */
const CUMULATIVE_KEY = /(:rings_total|:heart_beats|:rotations|^global:rings_total)$/;

export function flattenCumulativeRegressions(series) {
  const found = [];
  if (!series || typeof series !== 'object') return found;
  for (const key of Object.keys(series)) {
    if (!CUMULATIVE_KEY.test(key)) continue;
    const arr = series[key];
    if (!Array.isArray(arr)) continue;
    let max = null;
    let reported = false;
    for (let i = 0; i < arr.length; i += 1) {
      const v = arr[i];
      if (!Number.isFinite(v)) continue;
      if (max != null && v < max) {
        if (!reported) { found.push({ key, tick: i, drop: Math.round((max - v) * 10) / 10 }); reported = true; }
        arr[i] = max;
      } else {
        max = v;
      }
    }
  }
  return found;
}

export default flattenCumulativeRegressions;
```

`sessionBackfill.js` — in `buildSegmentsPerDevice` add to `seg`:

```js
      relabeled: Array.isArray(e.relabeledFrom) && e.relabeledFrom.length > 0,
      relabeledFrom: Array.isArray(e.relabeledFrom) ? [...e.relabeledFrom] : [],
      honored: Array.isArray(e.relabeledFrom) && e.relabeledFrom.length > 0,
```

(`honored` already exempts a segment from `applyEffortAbsorb`, cycling and late-tag merges.) In `detectCyclingSegments` make sure it does not reset `honored` to false for relabelled segments (only ever set it true). At the end of `runSessionBackfill` (series path) add relabelled-away names:

```js
  const relabeledAway = new Set();
  for (const segs of perDevice.values()) for (const seg of segs) for (const id of seg.relabeledFrom || []) relabeledAway.add(id);
  for (const id of keptOccupants) relabeledAway.delete(id);
  const removedOccupants = new Set([...collectFullyAbsorbedOccupants(perDevice), ...mergedFromIds, ...relabeledAway]);
```

and return that `removedOccupants`. Also exclude relabelled-away ids from `buildOccupancySegments`' series-only ghost creation is NOT needed — they are removed above.

`PersistenceManager.js`:

```js
  setParticipantDirectory({ primaryIds, names } = {}) {
    this._primaryIds = Array.isArray(primaryIds) ? new Set(primaryIds.map(String)) : null;
    this._configuredNames = names && typeof names === 'object' ? { ...names } : {};
  }
```

`buildParticipantsForPersist(roster, deviceAssignments, options)` — when `options.primaryIds` (Set) is supplied:

```js
    const directory = options?.primaryIds instanceof Set ? options.primaryIds : null;
    const configuredName = options?.names?.[participantId] || null;
    const displayName = configuredName || name;
    const isPrimary = directory ? directory.has(String(participantId)) : (isExplicitlyPrimary || (!isExplicitlyGuest && !isExplicitlyPrimary));
    const isGuest = directory ? !isPrimary : (isExplicitlyGuest && !isExplicitlyPrimary);
    const baseUser = isGuest && entry.baseUserName && entry.baseUserName !== displayName ? String(entry.baseUserName) : null;
```

and emit `display_name: displayName`, `base_user` only from `baseUser`. Pass `{ excludeOccupantIds, primaryIds: this._primaryIds, names: this._configuredNames }`.

Replace `_augmentRosterFromSeries` usage: when `sessionData.entities` is a non-empty array, call new `_augmentRosterFromStints(roster, entities)` (push `{ profileId, name, hrDeviceId: deviceId }` for each stint occupant not already in the roster, skipping closed `superseded` stints of occupants whose only stints are superseded with zero duration); otherwise keep the series-based call (legacy sessions).

After `const backfillResult = this._applyBackfill(sessionData);` add:

```js
    const regressions = flattenCumulativeRegressions(sessionData.timeline?.series);
    for (const r of regressions) {
      getLogger().warn('fitness.persistence.cumulative_regressed', { sessionId: sessionData.sessionId, ...r });
    }
```

`FitnessContext.jsx` next to `setKnownUserAliases`:

```js
    const usersCfg = fitnessRoot?.users || {};
    const allUsers = ['primary', 'secondary', 'family', 'friends']
      .flatMap((k) => (Array.isArray(usersCfg[k]) ? usersCfg[k] : []));
    session?._persistenceManager?.setParticipantDirectory?.({
      primaryIds: (Array.isArray(usersCfg.primary) ? usersCfg.primary : []).map((u) => u?.id || u?.profileId).filter(Boolean),
      names: Object.fromEntries(allUsers.filter((u) => u?.id && u?.name).map((u) => [u.id, u.name])),
    });
```

(add `fitnessRoot?.users` to that effect's dependency list). Confirm `fitnessRoot` is the object holding `users` by reading how `usersConfigRef` is fed in the same file; use that source if different.

- [ ] **Step 4: Run** `npx vitest run frontend/src/hooks/fitness/` — expect PASS.
- [ ] **Step 5: Commit** `git add -A frontend/src && git commit -m "feat(fitness): save-time honours relabelled stints; participant flags from config; cumulative guard"`

---

### Task 6: Healer — split repair, flags, summary patch, golden fixture

**Files:**
- Create: `backend/src/2_domains/fitness/services/CumulativeSplitRepair.mjs`
- Create: `backend/src/2_domains/fitness/services/CumulativeSplitRepair.test.mjs`
- Modify: `backend/src/2_domains/fitness/services/SessionIdentityHealer.mjs` (`buildSegmentsPerDevice` honour relabelled; `planHeal` reports `splitRepairs`)
- Modify: `cli/lib/fitness/heal.mjs` (apply repairs, flags, summary patch)
- Create: `backend/src/2_domains/fitness/services/__fixtures__/session-20260923183528.yml` (scrubbed)
- Test: extend `SessionIdentityHealer.golden.test.mjs`; `cli/lib/fitness/heal.test.mjs` (extend if present, else create)

**Interfaces:**
- Produces: `repairCumulativeSplits(decoded, { hrOf }) → { repairs: Array<{ metric, from, to, tick, amount }>, unpaired: Array<{ key, tick, drop }> }` (mutates `decoded`, on-disk keys `<id>:rings|beats|coins`); `planHeal(obj)` adds `splitRepairs` and `needsHeal` includes them.

- [ ] **Step 1: Build the scrubbed fixture.** From the live file (read via `sudo docker exec daylight-station sh -c 'cat data/household/fitness/log/2026-09-23/20260923183528.yml'`), write a node one-off in the scratchpad that: renames every real participant id and display name to its placeholder (`kid-a`, `kid-b`, `guest-c`, `kid-d`, `kid-e`, `parent`; the real-to-placeholder map lives only in the session scratchpad, never in the repo) in `participants`, series keys and `summary.participants`; drops `timeline.events` voice-memo transcripts and `strava*`; keeps everything else. Save as the fixture path above. `grep -iEf .claude/secret-patterns.local.txt <fixture>` (the PII guard's own pattern file) must print nothing.

- [ ] **Step 2: Write the failing tests.** `CumulativeSplitRepair.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { repairCumulativeSplits } from './CumulativeSplitRepair.mjs';

const hrOf = (d) => (id) => d[`${id}:hr`] || [];

describe('repairCumulativeSplits', () => {
  it('pairs a drop with a matching jump and cancels both', () => {
    const d = {
      'a:hr': [150, 150, 150, 150, 150], 'a:rings': [0, 40, 88, 1, 2],
      'b:hr': [null, null, null, 120, 120], 'b:rings': [0, 0, 1, 89, 90],
    };
    const { repairs, unpaired } = repairCumulativeSplits(d, { hrOf: hrOf(d) });
    expect(d['a:rings']).toEqual([0, 40, 88, 88, 89]);
    expect(d['b:rings']).toEqual([0, 0, 1, 2, 3]);
    expect(repairs).toEqual([{ metric: 'rings', from: 'b', to: 'a', tick: 3, amount: 87 }]);
    expect(unpaired).toEqual([]);
  });

  it('reports an unpaired drop without touching it', () => {
    const d = { 'a:hr': [150, 150, 150], 'a:rings': [0, 50, 3] };
    const { repairs, unpaired } = repairCumulativeSplits(d, { hrOf: hrOf(d) });
    expect(repairs).toEqual([]);
    expect(unpaired).toEqual([{ key: 'a:rings', tick: 2, drop: 47 }]);
    expect(d['a:rings']).toEqual([0, 50, 3]);
  });

  it('pairs beats with a relative tolerance', () => {
    const d = {
      'a:hr': [150, 150, 150, 150], 'a:beats': [500, 586.4, 20.2, 29.9],
      'b:hr': [null, 110, 110, 110], 'b:beats': [0, 10.2, 20.3, 596.6],
    };
    const { repairs } = repairCumulativeSplits(d, { hrOf: hrOf(d) });
    expect(repairs.map((r) => [r.metric, r.from, r.to])).toEqual([['beats', 'b', 'a']]);
    expect(d['a:beats'][2]).toBeCloseTo(586.4);
  });
});
```

Extend `SessionIdentityHealer.golden.test.mjs`:

```js
  it('heals the 2026-09-23 split: rings back to kid-a, ghosts removed', async () => {
    const obj = yaml.load(await fs.readFile(new URL('./__fixtures__/session-20260923183528.yml', import.meta.url), 'utf8'));
    const plan = planHeal(obj);
    expect(plan.needsHeal).toBe(true);
    expect(plan.splitRepairs.map((r) => [r.metric, r.from, r.to])).toEqual(
      expect.arrayContaining([['rings', 'kid-b', 'kid-a'], ['beats', 'kid-b', 'kid-a']]));
    expect(plan.removedOccupants).toEqual(expect.arrayContaining(['kid-d', 'kid-e']));
  });
```

`cli/lib/fitness/heal.test.mjs` (tmp baseDir with the fixture copied to `data/household/fitness/log/2026-09-23/20260923183528.yml` — match `fitnessHistoryDir`, and a `data/household/config/fitness.yml` with `users.primary: [{id: kid-a, name: Kid A}, {id: kid-d, name: Kid D}, {id: kid-e, name: Kid E}, {id: parent, name: Parent}]`, `users.friends: [{id: kid-b, name: Kid B}, {id: guest-c, name: Guest C}]`):

```js
  it('applies the split repair and patches the summary with rings', async () => {
    const res = await heal('2026-09-23', '20260923183528', { apply: true, baseDir });
    const p = res.out.summary.participants;
    expect(p['kid-a'].rings).toBe(381);
    expect(p['kid-b'].rings).toBe(91);
    expect(p['guest-c'].rings).toBe(508);
    expect(p).not.toHaveProperty('kid-d');
    expect(p).not.toHaveProperty('kid-e');
    expect(res.out.participants['kid-a']).toMatchObject({ is_primary: true });
    expect(res.out.participants['kid-a']).not.toHaveProperty('is_guest');
    expect(res.out.participants['guest-c']).toMatchObject({ is_guest: true });
    expect(res.out.summary.media?.length).toBeGreaterThan(0); // untouched sections survive
  });

  it('patched summary keeps rings (never reads :coins on a modern session)', async () => {
    const res = await heal('2026-09-23', '20260923183528', { apply: true, baseDir });
    expect(res.out.summary.participants.parent.rings).toBe(2);
  });

  it('heal is idempotent', async () => {
    await heal('2026-09-23', '20260923183528', { apply: true, baseDir });
    const again = await heal('2026-09-23', '20260923183528', { apply: false, baseDir });
    expect(again.plan.needsHeal).toBe(false);
  });
```

(381/91 are the expected values: 293+88 and 179−88. If the exact kid-b figure differs by the one ring kid-e contributed, assert against the value derived in the test from the fixture: `kidB = fixtureKidB − repairAmount`.)

- [ ] **Step 3: Run** `npx vitest run backend/src/2_domains/fitness/services/CumulativeSplitRepair backend/src/2_domains/fitness/services/SessionIdentityHealer cli/lib/fitness/heal` — expect FAIL.

- [ ] **Step 4: Implement** `CumulativeSplitRepair.mjs`:

```js
/**
 * Repair the signature the pre-2026-09 live transfer left in saved sessions:
 * one person's cumulative series DROPS by D while, within a few ticks, another
 * person's JUMPS by ~D. The rings were never lost — they were split. Cancel
 * the pair: the dropping person's line continues, the jumping person's line
 * loses the jump. The dropping person must have HR just before the drop (the
 * live transfer had already moved the HR trace to whoever really wore it).
 */
const METRICS = ['rings', 'coins', 'beats'];
const WINDOW = 3;
const tolerance = (d) => Math.max(2, d * 0.05);

const ffBefore = (arr, i) => { for (let k = i - 1; k >= 0; k -= 1) if (Number.isFinite(arr[k])) return arr[k]; return null; };

function steps(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i += 1) {
    if (!Number.isFinite(arr[i])) continue;
    const prev = ffBefore(arr, i);
    if (prev == null) continue;
    out.push({ tick: i, delta: arr[i] - prev });
  }
  return out;
}

export function repairCumulativeSplits(decoded, { hrOf } = {}) {
  const repairs = [];
  const unpaired = [];
  for (const metric of METRICS) {
    const keys = Object.keys(decoded).filter((k) => k.endsWith(`:${metric}`) && !/^(device|bike|vib|global):/.test(k));
    const ids = keys.map((k) => k.slice(0, -(metric.length + 1)));
    for (const to of ids) {
      const toKey = `${to}:${metric}`;
      for (const drop of steps(decoded[toKey]).filter((s) => s.delta < -tolerance(Math.abs(s.delta)) * 0 - 0.5)) {
        const D = -drop.delta;
        const hr = hrOf ? hrOf(to) : [];
        const hadHr = hr.slice(Math.max(0, drop.tick - 10), drop.tick).some((v) => Number.isFinite(v) && v > 0);
        let match = null;
        for (const from of ids) {
          if (from === to) continue;
          const jump = steps(decoded[`${from}:${metric}`])
            .find((s) => Math.abs(s.tick - drop.tick) <= WINDOW && s.delta > 0 && Math.abs(s.delta - D) <= tolerance(D));
          if (jump) { match = { from, tick: jump.tick }; break; }
        }
        if (!match || !hadHr) { unpaired.push({ key: toKey, tick: drop.tick, drop: Math.round(D * 10) / 10 }); continue; }
        const toArr = decoded[toKey];
        for (let i = drop.tick; i < toArr.length; i += 1) if (Number.isFinite(toArr[i])) toArr[i] += D;
        const fromArr = decoded[`${match.from}:${metric}`];
        const floor = ffBefore(fromArr, match.tick) ?? 0;
        for (let i = match.tick; i < fromArr.length; i += 1) {
          if (Number.isFinite(fromArr[i])) fromArr[i] = Math.max(floor, fromArr[i] - D);
        }
        const amount = Math.round(D * 10) / 10;
        repairs.push({ metric, from: match.from, to, tick: drop.tick, amount });
      }
    }
  }
  return { repairs, unpaired };
}

export default repairCumulativeSplits;
```

(Simplify the drop filter to `s.delta < 0` — a cumulative series has no legitimate negative step.)

`SessionIdentityHealer.mjs`: in its `buildSegmentsPerDevice`, mark `honored: true` when `e.relabeledFrom?.length` and skip honoured segments in `absorbInsignificantSegments`; add relabelled-away ids (not kept) to `removed`. In `planHeal`, after decoding, run `repairCumulativeSplits(structuredClone(decoded), { hrOf: (id) => decoded[`${id}:hr`] || [] })` and return `splitRepairs: repairs, unpairedDrops: unpaired`; `needsHeal` becomes `removed.size > 0 || merges.length > 0 || repairs.length > 0`.

`heal.mjs` `heal()`:
1. Before folding, `const { repairs } = repairCumulativeSplits(decoded, { hrOf: (id) => decoded[`${id}:hr`] || [] });`.
2. Load the directory: read `<baseDir>/data/household/config/fitness.yml` (use the same `fitnessHistoryDir` base convention; tolerate a missing file → no flag rewrite). `primaryIds = users.primary[].id`, `names` from all user lists.
3. Rewrite each kept participant: `display_name = names[id] || existing`; `is_primary: true` iff in primaryIds; `is_guest: true` iff not; `base_user` only for guests and only if it differs from display_name.
4. Replace `buildSummary(...)` with a patch: `summary = { ...(obj.summary || {}), participants: {} }` then for each kept participant compute `{ rings: lastNonNull(<id>:rings ?? <id>:coins), hr_avg, hr_max, hr_min, zone_minutes }` using `computeHrStats` and a local zone map `{ r: 'rest', c: 'cool', a: 'active', w: 'warm', h: 'hot', f: 'fire' }`; preserve any other keys already present on the old participant summary. Drop the `buildSummary` import.
5. Treat `:rings` as cumulative in `mergeCell`/`foldOccupantSeries` by extending `isCumulativeSeriesKey` in `cli/lib/fitnessSessionSummary.mjs` to `/:(coins|rings)(_total)?$/ || /:beats$/ || key === 'global:coins' || key === 'global:rings'`.
6. The sweep reporter prints `splitRepairs` alongside removed/merges.

- [ ] **Step 5: Run** the three test files plus `npx vitest run backend/src/2_domains/fitness cli/lib/fitness` — expect PASS.
- [ ] **Step 6: Commit** `git add -A backend/src/2_domains/fitness cli/lib && git commit -m "feat(fitness): healer repairs split cumulative series; flags from config; summary patched not rebuilt"`

---

### Task 7: Rendered chart verification

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx` (sim-controller effect ~line 1578: expose `window.__fitnessAssignGuest`)
- Create: `tests/live/flow/fitness/guest-reassign-chart.runtime.test.mjs`

- [ ] **Step 1: Expose the hook** inside the existing localhost/Chrome-gated sim effect, next to `window.__fitnessSimController = controller;`:

```js
          window.__fitnessAssignGuest = (deviceId, assignment) =>
            guestAssignmentServiceRef.current?.assignGuest(deviceId, assignment) ?? null;
```

and `delete window.__fitnessAssignGuest` in that effect's cleanup.

- [ ] **Step 2: Write the flow test.**

```js
import { test, expect } from '@playwright/test';
import { FRONTEND_URL, BACKEND_URL } from '#fixtures/runtime/urls.mjs';
import { FitnessSimHelper } from '#testlib/FitnessSimHelper.mjs';

test('reassignment chain keeps every chart line monotonic', async ({ page }) => {
  const cfg = await (await fetch(`${BACKEND_URL}/api/v1/fitness`, { signal: AbortSignal.timeout(10000) })).json();
  if (!cfg?.users?.primary?.length) throw new Error('FAIL FAST: no configured users');
  const friend = (cfg.users.friends || cfg.users.family || [])[0];
  if (!friend) throw new Error('FAIL FAST: no friend/family user to assign');

  await page.goto(`${FRONTEND_URL}/fitness`);
  await page.waitForSelector('.fitness-app, .fitness-player', { timeout: 15000 });
  const sim = new FitnessSimHelper(page);
  await sim.waitForController();
  const devices = (await sim.getDevices()).filter((d) => d.type === 'heart_rate' || d.profile === 'HR').slice(0, 2);
  if (devices.length < 2) throw new Error('FAIL FAST: need two HR devices');
  for (const d of devices) await sim.setZone(d.deviceId, 'warm');
  await page.waitForFunction(() => window.__fitnessSession?.sessionId, null, { timeout: 30000 });
  await page.waitForTimeout(30000);

  const owner = await page.evaluate((id) => window.__fitnessSession.userManager.resolveUserForDevice(id)?.id, devices[0].deviceId);
  const ownerName = cfg.users.primary.find((u) => u.id === owner)?.name || owner;
  await page.evaluate(([id, f]) => window.__fitnessAssignGuest(id, { name: f.name, profileId: f.id }), [devices[0].deviceId, friend]);
  await page.screenshot({ path: 'test-results/reassign-1-corrected-to-friend.png' });
  await page.waitForTimeout(30000);
  await page.evaluate(([id, o, n]) => window.__fitnessAssignGuest(id, { name: n, profileId: o }), [devices[0].deviceId, owner, ownerName]);
  await page.waitForTimeout(20000);
  await page.screenshot({ path: 'test-results/reassign-2-back-to-owner.png' });

  const report = await page.evaluate(() => {
    const s = window.__fitnessSession.timeline.series;
    const bad = [];
    for (const [k, arr] of Object.entries(s)) {
      if (!/:(rings_total|heart_beats)$/.test(k)) continue;
      let max = null;
      arr.forEach((v, i) => { if (!Number.isFinite(v)) return; if (max != null && v < max) bad.push({ k, i, v, max }); else max = v; });
    }
    const stints = window.__fitnessSession.entityRegistry.getAll().map((e) => e.summary);
    return { bad, stints };
  });
  expect(report.bad).toEqual([]);
  const stint = report.stints.find((e) => e.deviceId === String(devices[0].deviceId) && e.status === 'active');
  expect(stint.profileId).toBe(owner);
  expect(stint.relabeledFrom).toEqual([owner, friend.id]);
  await sim.stopAll();
});
```

- [ ] **Step 3: Run against a dev server from the worktree** (never the prod container): start the backend + Vite from the worktree on the dev ports for this host (`docs/runbooks/dev-server-multi-environment.md`), then `npx playwright test tests/live/flow/fitness/guest-reassign-chart.runtime.test.mjs --reporter=line`. Expected: PASS. Open both screenshots and look: every line rises or stays flat; no generic-guest avatar on the owner; no stranded dropout badge.
- [ ] **Step 4: Commit** `git add frontend/src/context/FitnessContext.jsx tests/live/flow/fitness/guest-reassign-chart.runtime.test.mjs && git commit -m "test(fitness): rendered chart through a strap reassignment chain"`

---

### Task 8: Docs, gate, merge, deploy, heal, verify

- [ ] **Step 1: Docs.** Update `docs/reference/fitness/assign-guest.md` (correction vs handover; `reassignStint`; stint relabel; transfer = stint delta), `docs/reference/fitness/guest-mode.md` (persisted flags: `is_primary` from config `primary`, `is_guest` otherwise, `base_user` guests only, `display_name` configured name), `docs/reference/fitness/fitness-system-architecture.md` (stint model; entity-keyed live paths removed). Mark the spec `Status: Implemented`.
- [ ] **Step 2: Full gate** on an untouched tree: `npm run test:unit:vitest` — record the real exit code; compare against the pre-change baseline (587 passing in the fitness subset; 2 pre-existing teardown errors in `GovernanceEngine.sensorBlip.test.js`).
- [ ] **Step 3: Fable review** of the branch diff (`model: fable`), adopt findings, re-run the gate.
- [ ] **Step 4: Merge** into `main` (no PR), record the branch in `docs/_archive/deleted-branches.md`, delete the branch and worktree.
- [ ] **Step 5: Deploy** — `./scripts/deploy-gate.sh` must exit 0; `./scripts/build-daylight.sh`; re-run the gate; `sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight`; confirm `/build.txt` carries the merge SHA; reload the garage kiosk by window name and confirm via screenshot.
- [ ] **Step 6: Heal** — inside the container: `node cli/fitness.cli.mjs session heal --sweep --since=120d` (dry run), review every planned change, then `--apply` for the approved sessions starting with `2026-09-23 20260923183528`; confirm the session list API now shows ≈381 / ≈91 and no `kid-d`/`kid-e` equivalents.
- [ ] **Step 7: Production watch** — after the next real session with a reassignment, the log store shows zero `fitness.persistence.cumulative_regressed` and zero `treasurebox.transfer_disabled`, and the saved `entities` match what happened.
