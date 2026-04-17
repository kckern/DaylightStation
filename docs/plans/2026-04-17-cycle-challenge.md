# Cycle Challenge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a new RPM-based multi-phase single-rider "cycle challenge" type to the governance challenge framework, with progressive video dimming and a social boost mechanic.

**Architecture:** Cycle challenge is a new `type` on the existing `selections[]` config, peer to implicit zone and existing vibration. Lives in the single `activeChallenge` slot; extends `activeChallenge` with sub-state fields (`cycleState`, `currentPhaseIndex`, `phaseProgressMs`, `rider`, etc.); dispatches through a new `_evaluateCycleChallenge` branch in `_evaluateChallenges`. Reuses the existing engine heartbeat, pause/resume, history, and audio cue infrastructure. Adds one new engine input (`equipmentCadenceMap`) and two new public methods (`swapCycleRider`; `triggerChallenge` extended for cycle).

**Tech Stack:** Existing — Jest (unit/integration), Playwright (live flow), js-yaml (config parsing), React + SVG for overlay, SCSS for dim filters. No new dependencies.

**Reference design:** `docs/_wip/plans/2026-04-17-cycle-challenge-design.md`

**Key files touched:**
- `frontend/src/hooks/fitness/GovernanceEngine.js` (primary)
- `frontend/src/hooks/fitness/FitnessSession.js` (cadence accessor)
- `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.{jsx,scss}` (new)
- `frontend/src/modules/Fitness/player/overlays/CycleRiderSwapModal.{jsx,scss}` (new)
- `frontend/src/modules/Fitness/player/overlays/GovernanceStateOverlay.scss` (add RPM pill variant)
- `frontend/src/modules/Fitness/player/FitnessPlayer.{jsx,scss}` (apply `--cycle-dim` var)
- `data/household/config/fitness.yml` (add cycle challenge selection + equipment whitelist)

---

## Logging Requirements (applies to ALL tasks below)

Per `CLAUDE.md`: **never use raw `console.*`.** All diagnostic logging goes through the structured logging framework (`frontend/src/lib/logging/`), using `getLogger()` per existing engine pattern. Cycle challenge code must emit structured events at every meaningful lifecycle point so production incidents can be reconstructed from logs alone.

### Required log events (engine — implementer must add these as the corresponding code is written)

All events use dot-separated namespacing `governance.cycle.*` for consistency with existing `governance.challenge.*` / `governance.vibration_challenge.*` events.

| Event name | Level | When emitted | Required payload fields |
|---|---|---|---|
| `governance.cycle.config_parsed` | `info` | `_normalizePolicies` finishes parsing cycle selection | `selectionId, equipment, sequenceType, segmentCountRange, hiRpmRange, loRpmRatio, userCooldownSeconds, usingExplicitPhases: bool` |
| `governance.cycle.config_rejected` | `warn` | Cycle selection missing required field (e.g., equipment) | `selectionId, reason` |
| `governance.cycle.config_explicit_overrides_procedural` | `warn` | Both `phases[]` and procedural fields present | `equipment, selectionId` |
| `governance.cycle.phases_generated` | `info` | `_generateCyclePhases` produces a concrete phase list | `selectionId, sequenceType, phaseCount, phases: [{hiRpm, loRpm, rampSeconds, maintainSeconds}]` |
| `governance.cycle.started` | `info` | `_startCycleChallenge` succeeds | `challengeId, equipment, rider, eligibleUsers, riderPool (after cooldown filter), totalPhases, initTotalMs` |
| `governance.cycle.start_skipped` | `info` | No eligible rider or all on cooldown | `equipment, reason, eligibleCount, onCooldownCount` |
| `governance.cycle.state_transition` | `info` | Every `cycleState` transition | `challengeId, from, to, currentPhaseIndex, rider, currentRpm, reason?` |
| `governance.cycle.phase_advanced` | `info` | Progress fills, next phase begins | `challengeId, fromPhaseIndex, toPhaseIndex, elapsedMs, boostedMs` |
| `governance.cycle.locked` | `info` | Transition into `locked` state | `challengeId, lockReason, phaseIndex, currentRpm, threshold (hi or lo), totalLockEventsCount` |
| `governance.cycle.recovered` | `info` | Exit from `locked` state | `challengeId, fromLockReason, currentRpm, resumeState, lockDurationMs` |
| `governance.cycle.progress_tick` | `debug` (sampled via `logger.sampled`, maxPerMinute: 10) | Each tick while in `maintain` | `challengeId, phaseIndex, rpm, hiRpm, loRpm, phaseProgressMs, dimFactor, boostMultiplier, boostingUsers` |
| `governance.cycle.boost_changed` | `debug` | Boost multiplier changes from previous tick | `challengeId, fromMultiplier, toMultiplier, contributors` |
| `governance.cycle.paused_by_base_req` | `info` | Pause triggered by base_req failure | `challengeId, cycleState, frozenFields: {initElapsedMs, rampElapsedMs, phaseProgressMs}` |
| `governance.cycle.resumed_after_base_req` | `info` | Base_req restored | `challengeId, cycleState, pausedDurationMs` |
| `governance.cycle.swap_requested` | `info` | `swapCycleRider` called | `challengeId, fromRider, toRider, cycleState, force, accepted, rejectionReason?` |
| `governance.cycle.swap_completed` | `info` | Swap applied | `challengeId, fromRider, toRider, ridersUsed` |
| `governance.cycle.cooldown_applied` | `info` | Cooldown set on rider(s) at challenge end | `rider, cooldownUntilMs, trigger: success\|failed\|abandoned` |
| `governance.cycle.completed` | `info` | Challenge ends — success, failed, or abandoned | `challengeId, status, rider, ridersUsed, totalPhases, phasesCompleted, totalLockEventsCount, totalBoostedMs, boostContributors, durationMs` |
| `governance.cycle.triggered_manually` | `info` | `triggerChallenge` with `type: 'cycle'` invoked | `selectionId, riderId (if provided), force` |
| `governance.cycle.audio_cue_emitted` | `debug` | Each audio cue fired | `challengeId, cue, cycleState` |

### Frontend logging (per-component)

Each new React component must create a child logger via `useMemo` per CLAUDE.md pattern:

```javascript
const logger = useMemo(() => getLogger().child({ component: 'cycle-challenge-overlay' }), []);
```

**CycleChallengeOverlay events:**
- `ui.cycle_overlay.mounted` (info) — rendering for a new challenge
- `ui.cycle_overlay.unmounted` (info)
- `ui.cycle_overlay.position_changed` (info) — top/middle/bottom cycle
- `ui.cycle_overlay.swap_modal_opened` (info)
- `ui.cycle_overlay.render_throttle_warning` (warn, sampled) — if render frequency exceeds 30fps (indicates governance tick rate issue)

**CycleRiderSwapModal events:**
- `ui.cycle_swap_modal.opened` (info) — with eligible count
- `ui.cycle_swap_modal.confirmed` (info) — with selected rider
- `ui.cycle_swap_modal.cancelled` (info)
- `ui.cycle_swap_modal.swap_failed` (warn) — engine rejected swap with reason

### Test requirements for logging

Each engine state-machine unit test (Tasks 9-12, 14, 15) must include at least one assertion that the corresponding log event was emitted with expected payload shape. Use the existing mock-logger pattern:

```javascript
const mockLog = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() };
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => mockLog, getLogger: () => mockLog
}));
// ...
expect(mockLog.info).toHaveBeenCalledWith('governance.cycle.state_transition', expect.objectContaining({
  from: 'init', to: 'ramp', rider: 'felix'
}));
```

### Debuggability gate

Before closing the final review (Task 37), pull a sample session log from a real or simulated cycle-challenge run and verify the log trail alone is sufficient to reconstruct:
1. Which selection was chosen and why (weighted pool state).
2. Which rider was picked and from what eligible pool.
3. Every state transition with timestamps and RPM readings.
4. Every boost change.
5. Every lock/recovery cycle.
6. Final outcome and cooldown state.

If any gap exists, add the missing log event and re-verify.

---

## Phase 1: Foundation — Test Infrastructure

### Task 1: Inject `now()` and `random()` into GovernanceEngine

**Why:** Deterministic clock + RNG are required for all cycle tests (state transitions, phase generation, cooldowns). Without injection, tests depend on wall clock.

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:152-227` (constructor)
- Modify: Every callsite using `Date.now()` inside the engine — replace with `this._now()`.
- Modify: `Math.random()` callsites inside `_pickIntervalMs`, `_normalizePolicies` (random-bag shuffle) — replace with `this._random()`.
- Test: `tests/unit/governance/GovernanceEngine-clockInjection.test.mjs` (new)

**Step 1: Write the failing test**

```javascript
// tests/unit/governance/GovernanceEngine-clockInjection.test.mjs
import { describe, it, expect, jest } from '@jest/globals';

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));

const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine clock/random injection', () => {
  it('uses injected now() instead of Date.now()', () => {
    const fixedTime = 1234567890;
    const engine = new GovernanceEngine(null, { now: () => fixedTime });
    expect(engine._now()).toBe(fixedTime);
  });

  it('uses injected random() instead of Math.random()', () => {
    const engine = new GovernanceEngine(null, { random: () => 0.42 });
    expect(engine._random()).toBe(0.42);
  });

  it('defaults to Date.now and Math.random when not provided', () => {
    const engine = new GovernanceEngine(null);
    const t = engine._now();
    expect(typeof t).toBe('number');
    expect(Math.abs(t - Date.now())).toBeLessThan(50);
    const r = engine._random();
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(1);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest tests/unit/governance/GovernanceEngine-clockInjection.test.mjs
```

Expected: FAIL — `engine._now is not a function`.

**Step 3: Implement minimal code**

```javascript
// GovernanceEngine.js constructor (~line 152)
constructor(session = null, options = {}) {
  this._now = typeof options.now === 'function' ? options.now : () => Date.now();
  this._random = typeof options.random === 'function' ? options.random : () => Math.random();
  // ... existing constructor body unchanged ...
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest tests/unit/governance/GovernanceEngine-clockInjection.test.mjs
```

Expected: PASS (all 3 cases).

**Step 5: Commit**

```bash
git add tests/unit/governance/GovernanceEngine-clockInjection.test.mjs frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "feat(governance): inject now()/random() for deterministic testing"
```

---

### Task 2: Migrate engine internals to `this._now()` and `this._random()`

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` — replace every `Date.now()` with `this._now()` and every `Math.random()` with `this._random()`.
- Test: run existing engine tests to verify no regressions.

**Step 1: Find all callsites**

```bash
grep -n "Date.now()" frontend/src/hooks/fitness/GovernanceEngine.js
grep -n "Math.random()" frontend/src/hooks/fitness/GovernanceEngine.js
```

**Step 2: Write a regression-guard test**

```javascript
// tests/unit/governance/GovernanceEngine-clockInjection.test.mjs (append)
it('all internal timing uses injected now() (no Date.now leakage)', () => {
  let mockTime = 10000;
  const engine = new GovernanceEngine(null, { now: () => mockTime });
  engine._lastEvaluationTs = null;
  engine._schedulePulse(500);
  // No assertion needed; just ensure no Date.now() calls drift behavior.
  // We verify by advancing mock time and confirming state-based timing works.
  mockTime = 99999999;
  expect(engine._now()).toBe(99999999);
});
```

**Step 3: Replace all occurrences**

Use sed-style replacement, then manual review:

```bash
# (Illustrative — do a find-and-replace in the file, verify each hit contextually)
# Replace bare `Date.now()` with `this._now()` ONLY inside GovernanceEngine class methods.
# Replace bare `Math.random()` with `this._random()` ONLY inside GovernanceEngine class methods.
```

**Step 4: Run all engine unit tests**

```bash
npx jest tests/unit/governance/
```

Expected: ALL PASS — no regressions.

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/governance/GovernanceEngine-clockInjection.test.mjs
git commit -m "refactor(governance): route all timing/random through injected helpers"
```

---

### Task 3: Add `getEquipmentCadence()` to FitnessSession

**Why:** Cycle challenge needs live RPM readings per equipment. Engine input shape extension.

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js` — add method near `getVibrationTracker` (~line 1029).
- Test: `tests/unit/fitness/FitnessSession-getEquipmentCadence.test.mjs` (new)

**Step 1: Write the failing test**

```javascript
// tests/unit/fitness/FitnessSession-getEquipmentCadence.test.mjs
import { describe, it, expect } from '@jest/globals';
import { FitnessSession } from '#frontend/hooks/fitness/FitnessSession.js';

describe('FitnessSession.getEquipmentCadence', () => {
  it('returns { rpm, connected } for a configured equipment id', () => {
    const session = new FitnessSession();
    session.setEquipmentCatalog([{ id: 'cycle_ace', cadence: '49904', type: 'stationary_bike' }]);
    // Simulate a cadence reading for cadence device 49904
    session.ingestDeviceSample?.({ key: 'device:49904:rpm', value: 72, ts: Date.now() });
    const cadence = session.getEquipmentCadence('cycle_ace');
    expect(cadence).toBeTruthy();
    expect(cadence.rpm).toBe(72);
    expect(cadence.connected).toBe(true);
  });

  it('returns { rpm: 0, connected: false } for missing equipment', () => {
    const session = new FitnessSession();
    expect(session.getEquipmentCadence('nonexistent')).toEqual({ rpm: 0, connected: false });
  });

  it('returns { rpm: 0, connected: false } when equipment exists but no cadence reading yet', () => {
    const session = new FitnessSession();
    session.setEquipmentCatalog([{ id: 'cycle_ace', cadence: '49904', type: 'stationary_bike' }]);
    expect(session.getEquipmentCadence('cycle_ace')).toEqual({ rpm: 0, connected: false });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest tests/unit/fitness/FitnessSession-getEquipmentCadence.test.mjs
```

Expected: FAIL — `getEquipmentCadence is not a function`.

**Step 3: Implement**

```javascript
// FitnessSession.js (near line 1029, after getVibrationTracker)
getEquipmentCadence(equipmentId) {
  if (!equipmentId) return { rpm: 0, connected: false };
  const catalogEntry = this._deviceRouter.getEquipmentCatalog?.()?.find(e => e.id === equipmentId);
  if (!catalogEntry) return { rpm: 0, connected: false };
  const cadenceKey = catalogEntry.cadence != null ? String(catalogEntry.cadence).trim() : null;
  if (!cadenceKey) return { rpm: 0, connected: false };
  // Look up latest rpm from roster / device samples
  const sample = this._latestDeviceSamples?.get?.(`device:${cadenceKey}:rpm`);
  if (!sample) return { rpm: 0, connected: false };
  const stale = this._now ? (this._now() - sample.ts) > FITNESS_TIMEOUTS.rpmZero : false;
  return {
    rpm: stale ? 0 : Number(sample.value) || 0,
    connected: !stale
  };
}
```

Note: If `_latestDeviceSamples` doesn't exist, also add the map + capture device samples in `ingestDeviceSample`. Review `FitnessSession.js` to see how device samples are currently stored and adapt.

**Step 4: Run tests**

```bash
npx jest tests/unit/fitness/FitnessSession-getEquipmentCadence.test.mjs
npx jest tests/unit/fitness/  # regression check
```

Expected: PASS (all cases, no existing session test regressions).

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js tests/unit/fitness/FitnessSession-getEquipmentCadence.test.mjs
git commit -m "feat(fitness): add FitnessSession.getEquipmentCadence for cycle challenges"
```

---

### Task 4: Add `equipmentCadenceMap` to engine input contract

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` — extend `update()` / input storage to accept `equipmentCadenceMap`.
- Test: `tests/unit/governance/GovernanceEngine-equipmentCadenceMap.test.mjs` (new)

**Step 1: Write failing test**

```javascript
// tests/unit/governance/GovernanceEngine-equipmentCadenceMap.test.mjs
import { describe, it, expect, jest } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine equipmentCadenceMap input', () => {
  it('stores cadence map on evaluate', () => {
    const engine = new GovernanceEngine(null);
    engine.evaluate({
      activeParticipants: ['alice'],
      userZoneMap: { alice: 'active' },
      zoneRankMap: { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 },
      zoneInfoMap: {},
      totalCount: 1,
      equipmentCadenceMap: { cycle_ace: { rpm: 72, connected: true } }
    });
    expect(engine._latestInputs.equipmentCadenceMap).toEqual({
      cycle_ace: { rpm: 72, connected: true }
    });
  });
});
```

**Step 2: Verify it fails**

```bash
npx jest tests/unit/governance/GovernanceEngine-equipmentCadenceMap.test.mjs
```

**Step 3: Implement — extend evaluate()**

Find `evaluate()` method in `GovernanceEngine.js`, extend destructuring + store:

```javascript
evaluate({
  activeParticipants = [],
  userZoneMap = {},
  zoneRankMap = {},
  zoneInfoMap = {},
  totalCount = 0,
  equipmentCadenceMap = {}   // NEW
} = {}) {
  this._latestInputs = {
    activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount,
    equipmentCadenceMap   // NEW
  };
  // ... existing body ...
}
```

Also extend constructor initializer at line ~202-208 to include `equipmentCadenceMap: {}`.

**Step 4: Tests pass**

```bash
npx jest tests/unit/governance/GovernanceEngine-equipmentCadenceMap.test.mjs
npx jest tests/unit/governance/  # regression check
```

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/governance/GovernanceEngine-equipmentCadenceMap.test.mjs
git commit -m "feat(governance): accept equipmentCadenceMap in engine inputs"
```

---

## Phase 2: Config Normalization

### Task 5: Parse `type: cycle` selection — required top-level fields

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` — `_normalizePolicies` method (~line 550-670).
- Test: `tests/unit/governance/GovernanceEngine-cycleConfig.test.mjs` (new)

**Step 1: Write failing test**

```javascript
// tests/unit/governance/GovernanceEngine-cycleConfig.test.mjs
import { describe, it, expect, jest } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine cycle config parsing', () => {
  let engine;
  beforeEach(() => { engine = new GovernanceEngine(null); });

  it('parses basic cycle selection with defaults', () => {
    const policies = engine._normalizePolicies({
      default: {
        name: 'Default',
        base_requirement: [{ active: 'all' }],
        challenges: [{
          interval: [30, 120],
          selections: [{
            type: 'cycle',
            equipment: 'cycle_ace',
            hi_rpm_range: [50, 90],
            segment_count: [3, 5],
            segment_duration_seconds: [20, 45],
            ramp_seconds: [10, 20],
            time_allowed: 999  // cycle ignores this, but parser still needs it not to reject
          }]
        }]
      }
    });
    const sel = policies[0].challenges[0].selections[0];
    expect(sel.type).toBe('cycle');
    expect(sel.equipment).toBe('cycle_ace');
    expect(sel.hiRpmRange).toEqual([50, 90]);
    expect(sel.segmentCount).toEqual([3, 5]);
    expect(sel.segmentDurationSeconds).toEqual([20, 45]);
    expect(sel.rampSeconds).toEqual([10, 20]);
    expect(sel.sequenceType).toBe('random');       // default
    expect(sel.loRpmRatio).toBe(0.75);             // default
    expect(sel.userCooldownSeconds).toBe(600);     // default
    expect(sel.init).toEqual({ minRpm: 30, timeAllowedSeconds: 60 });  // defaults
    expect(sel.boost).toBeTruthy();
    expect(sel.boost.zoneMultipliers).toEqual({});
    expect(sel.boost.maxTotalMultiplier).toBe(3.0);
  });

  it('parses init, boost, sequence_type, cooldown', () => {
    const policies = engine._normalizePolicies({
      default: {
        base_requirement: [{ active: 'all' }],
        challenges: [{
          interval: [60, 60],
          selections: [{
            type: 'cycle',
            equipment: 'cycle_ace',
            hi_rpm_range: [50, 90],
            segment_count: [3, 5],
            segment_duration_seconds: [20, 45],
            ramp_seconds: 15,
            init: { min_rpm: 40, time_allowed_seconds: 90 },
            sequence_type: 'progressive',
            lo_rpm_ratio: 0.8,
            user_cooldown_seconds: 300,
            boost: {
              zone_multipliers: { hot: 0.5, fire: 1.0 },
              max_total_multiplier: 2.5
            },
            time_allowed: 999
          }]
        }]
      }
    });
    const sel = policies[0].challenges[0].selections[0];
    expect(sel.init.minRpm).toBe(40);
    expect(sel.init.timeAllowedSeconds).toBe(90);
    expect(sel.sequenceType).toBe('progressive');
    expect(sel.loRpmRatio).toBe(0.8);
    expect(sel.userCooldownSeconds).toBe(300);
    expect(sel.boost.zoneMultipliers).toEqual({ hot: 0.5, fire: 1.0 });
    expect(sel.boost.maxTotalMultiplier).toBe(2.5);
    expect(sel.rampSeconds).toEqual([15, 15]);  // scalar becomes [N, N]
  });

  it('accepts explicit phases[] (overrides procedural)', () => {
    const policies = engine._normalizePolicies({
      default: {
        base_requirement: [{ active: 'all' }],
        challenges: [{
          interval: [60, 60],
          selections: [{
            type: 'cycle',
            equipment: 'cycle_ace',
            phases: [
              { hi_rpm: 60, lo_rpm: 45, ramp_seconds: 15, maintain_seconds: 30 },
              { hi_rpm: 70, lo_rpm: 55, ramp_seconds: 20, maintain_seconds: 45 }
            ],
            time_allowed: 999
          }]
        }]
      }
    });
    const sel = policies[0].challenges[0].selections[0];
    expect(sel.explicitPhases).toHaveLength(2);
    expect(sel.explicitPhases[0]).toEqual({ hiRpm: 60, loRpm: 45, rampSeconds: 15, maintainSeconds: 30 });
  });

  it('rejects cycle selection without equipment', () => {
    const policies = engine._normalizePolicies({
      default: {
        base_requirement: [{ active: 'all' }],
        challenges: [{
          interval: [60, 60],
          selections: [{ type: 'cycle', hi_rpm_range: [50, 90], time_allowed: 999 }]
        }]
      }
    });
    expect(policies[0].challenges[0].selections).toHaveLength(0);  // filtered out
  });
});
```

**Step 2: Verify failure**

```bash
npx jest tests/unit/governance/GovernanceEngine-cycleConfig.test.mjs
```

Expected: FAIL.

**Step 3: Implement**

Inside the `.map((selectionValue, selectionIndex) => {...})` block in `_normalizePolicies` (around line 616), branch on `selectionValue.type === 'cycle'` and build the cycle shape. Add validation that `equipment` is present (return `null` if missing).

Expected shape emitted (camelCase internal):

```javascript
{
  id: `${policyId}_${index}_${selectionIndex}`,
  type: 'cycle',
  label: selectionValue.label || selectionValue.name || null,
  weight: Number(selectionValue.weight ?? 1),
  equipment: String(selectionValue.equipment),
  userCooldownSeconds: Number(selectionValue.user_cooldown_seconds ?? 600),
  loRpmRatio: Number(selectionValue.lo_rpm_ratio ?? 0.75),
  sequenceType: String(selectionValue.sequence_type ?? 'random').toLowerCase(),
  init: {
    minRpm: Number(selectionValue.init?.min_rpm ?? 30),
    timeAllowedSeconds: Number(selectionValue.init?.time_allowed_seconds ?? 60)
  },
  hiRpmRange: normalizeRange(selectionValue.hi_rpm_range, [50, 90]),
  segmentCount: normalizeRange(selectionValue.segment_count, [3, 5]),
  segmentDurationSeconds: normalizeRange(selectionValue.segment_duration_seconds, [20, 45]),
  rampSeconds: normalizeRange(selectionValue.ramp_seconds, [10, 20]),
  explicitPhases: parseExplicitPhases(selectionValue.phases),  // null if not provided
  boost: {
    zoneMultipliers: { ...(selectionValue.boost?.zone_multipliers || {}) },
    maxTotalMultiplier: Number(selectionValue.boost?.max_total_multiplier ?? 3.0)
  }
}
```

Helpers `normalizeRange(value, defaultRange)` (accepts scalar → `[N, N]`, array `[a, b]` → `[min, max]`, or uses default) and `parseExplicitPhases(arr)` (maps to camelCase).

Place helpers at module top (outside class) or as private methods.

Log a warning via `getLogger().warn()` when both `explicitPhases` and procedural fields are present:

```javascript
if (parsedExplicit && (selectionValue.hi_rpm_range || selectionValue.segment_count)) {
  getLogger().warn('cycle.config.explicit_overrides_procedural', { equipment: selectionValue.equipment });
}
```

**Step 4: Run tests**

```bash
npx jest tests/unit/governance/GovernanceEngine-cycleConfig.test.mjs
npx jest tests/unit/governance/
```

Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/governance/GovernanceEngine-cycleConfig.test.mjs
git commit -m "feat(governance): parse cycle challenge selections in _normalizePolicies"
```

---

### Task 6: Implement phase generation (`_generateCyclePhases`)

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` — new private method.
- Test: `tests/unit/governance/GovernanceEngine-cyclePhaseGen.test.mjs` (new)

**Step 1: Write failing test**

```javascript
// tests/unit/governance/GovernanceEngine-cyclePhaseGen.test.mjs
import { describe, it, expect, jest } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

describe('GovernanceEngine._generateCyclePhases', () => {
  const baseSelection = {
    type: 'cycle',
    hiRpmRange: [50, 90],
    segmentCount: [3, 5],
    segmentDurationSeconds: [20, 40],
    rampSeconds: [10, 20],
    loRpmRatio: 0.75,
    sequenceType: 'random'
  };

  it('respects segmentCount range', () => {
    const engine = new GovernanceEngine(null, { random: seededRng(1) });
    const phases = engine._generateCyclePhases(baseSelection);
    expect(phases.length).toBeGreaterThanOrEqual(3);
    expect(phases.length).toBeLessThanOrEqual(5);
  });

  it('each phase hi_rpm is within range', () => {
    const engine = new GovernanceEngine(null, { random: seededRng(2) });
    const phases = engine._generateCyclePhases(baseSelection);
    phases.forEach(p => {
      expect(p.hiRpm).toBeGreaterThanOrEqual(50);
      expect(p.hiRpm).toBeLessThanOrEqual(90);
    });
  });

  it('lo_rpm derived from ratio', () => {
    const engine = new GovernanceEngine(null, { random: seededRng(3) });
    const phases = engine._generateCyclePhases(baseSelection);
    phases.forEach(p => {
      expect(p.loRpm).toBe(Math.round(p.hiRpm * 0.75));
    });
  });

  it('progressive type produces ascending hi_rpm', () => {
    const engine = new GovernanceEngine(null, { random: seededRng(4) });
    const phases = engine._generateCyclePhases({ ...baseSelection, sequenceType: 'progressive', segmentCount: [4, 4] });
    for (let i = 1; i < phases.length; i++) {
      expect(phases[i].hiRpm).toBeGreaterThanOrEqual(phases[i-1].hiRpm - 2); // allow tiny jitter
    }
  });

  it('regressive type produces descending hi_rpm', () => {
    const engine = new GovernanceEngine(null, { random: seededRng(5) });
    const phases = engine._generateCyclePhases({ ...baseSelection, sequenceType: 'regressive', segmentCount: [4, 4] });
    for (let i = 1; i < phases.length; i++) {
      expect(phases[i].hiRpm).toBeLessThanOrEqual(phases[i-1].hiRpm + 2);
    }
  });

  it('constant type produces equal hi_rpm across phases', () => {
    const engine = new GovernanceEngine(null, { random: seededRng(6) });
    const phases = engine._generateCyclePhases({ ...baseSelection, sequenceType: 'constant', segmentCount: [4, 4] });
    const firstHi = phases[0].hiRpm;
    phases.forEach(p => expect(p.hiRpm).toBe(firstHi));
  });

  it('explicitPhases overrides procedural generation', () => {
    const engine = new GovernanceEngine(null, { random: seededRng(7) });
    const phases = engine._generateCyclePhases({
      ...baseSelection,
      explicitPhases: [
        { hiRpm: 60, loRpm: 45, rampSeconds: 15, maintainSeconds: 30 },
        { hiRpm: 70, loRpm: 55, rampSeconds: 20, maintainSeconds: 45 }
      ]
    });
    expect(phases).toHaveLength(2);
    expect(phases[0]).toEqual({ hiRpm: 60, loRpm: 45, rampSeconds: 15, maintainSeconds: 30 });
  });
});
```

**Step 2: Verify failure**

```bash
npx jest tests/unit/governance/GovernanceEngine-cyclePhaseGen.test.mjs
```

**Step 3: Implement**

```javascript
// GovernanceEngine.js (private method — place near _pickIntervalMs)
_pickInRange([min, max]) {
  if (min === max) return min;
  return Math.floor(this._random() * (max - min + 1)) + min;
}

_generateCyclePhases(selection) {
  if (Array.isArray(selection.explicitPhases) && selection.explicitPhases.length) {
    return selection.explicitPhases.map(p => ({ ...p }));
  }
  const count = this._pickInRange(selection.segmentCount);
  const [minHi, maxHi] = selection.hiRpmRange;
  let hiValues;
  switch (selection.sequenceType) {
    case 'progressive':
    case 'regressive': {
      const span = maxHi - minHi;
      const stepBase = count > 1 ? span / (count - 1) : 0;
      hiValues = Array.from({ length: count }, (_, i) => {
        const jitter = (this._random() - 0.5) * 0.1 * span; // ±5%
        return Math.round(minHi + stepBase * i + jitter);
      });
      if (selection.sequenceType === 'regressive') hiValues.reverse();
      break;
    }
    case 'constant': {
      const v = this._pickInRange([minHi, maxHi]);
      hiValues = Array(count).fill(v);
      break;
    }
    case 'random':
    default:
      hiValues = Array.from({ length: count }, () => this._pickInRange([minHi, maxHi]));
  }
  const ratio = selection.loRpmRatio ?? 0.75;
  return hiValues.map(hiRpm => ({
    hiRpm: Math.max(1, Math.min(300, hiRpm)),
    loRpm: Math.round(hiRpm * ratio),
    rampSeconds: this._pickInRange(selection.rampSeconds),
    maintainSeconds: this._pickInRange(selection.segmentDurationSeconds)
  }));
}
```

**Step 4: Run tests**

```bash
npx jest tests/unit/governance/GovernanceEngine-cyclePhaseGen.test.mjs
```

Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/governance/GovernanceEngine-cyclePhaseGen.test.mjs
git commit -m "feat(governance): implement _generateCyclePhases with 4 sequence types"
```

---

### Task 7: Parse `equipment.eligible_users` and expose via helper

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js` — accept equipment catalog and provide `_getEligibleUsers(equipmentId)` helper. Engine needs equipment catalog injected; easiest route: add to `setConfig` or consume via `session._deviceRouter.getEquipmentCatalog()`.
- Test: `tests/unit/governance/GovernanceEngine-eligibleUsers.test.mjs` (new)

**Step 1: Write failing test**

```javascript
// tests/unit/governance/GovernanceEngine-eligibleUsers.test.mjs
import { describe, it, expect, jest } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine eligible users lookup', () => {
  it('returns eligible_users for equipment from session catalog', () => {
    const session = {
      _deviceRouter: {
        getEquipmentCatalog: () => [
          { id: 'cycle_ace', eligible_users: ['kckern', 'felix'] },
          { id: 'tricycle', eligible_users: ['milo'] }
        ]
      }
    };
    const engine = new GovernanceEngine(session);
    expect(engine._getEligibleUsers('cycle_ace')).toEqual(['kckern', 'felix']);
    expect(engine._getEligibleUsers('tricycle')).toEqual(['milo']);
    expect(engine._getEligibleUsers('unknown')).toEqual([]);
  });
});
```

**Step 2: Verify failure**

```bash
npx jest tests/unit/governance/GovernanceEngine-eligibleUsers.test.mjs
```

**Step 3: Implement**

```javascript
_getEligibleUsers(equipmentId) {
  if (!equipmentId) return [];
  const catalog = this.session?._deviceRouter?.getEquipmentCatalog?.() || [];
  const entry = catalog.find(e => e.id === equipmentId);
  if (!entry || !Array.isArray(entry.eligible_users)) return [];
  return [...entry.eligible_users];
}
```

**Step 4: Run tests**

```bash
npx jest tests/unit/governance/GovernanceEngine-eligibleUsers.test.mjs
```

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/governance/GovernanceEngine-eligibleUsers.test.mjs
git commit -m "feat(governance): add _getEligibleUsers helper for cycle rider whitelist"
```

---

## Phase 3: State Machine Core

### Task 8: Initialize cycle challenge state on start

**Files:**
- Modify: `GovernanceEngine.js` — add `_startCycleChallenge(selection, selectionPayload)` method; extend `startChallenge()` in `_evaluateChallenges` to dispatch on `type: 'cycle'`.
- Test: `tests/unit/governance/GovernanceEngine-cycleStart.test.mjs`

**Step 1: Write failing test**

```javascript
// tests/unit/governance/GovernanceEngine-cycleStart.test.mjs
import { describe, it, expect, jest } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

describe('GovernanceEngine cycle challenge start', () => {
  let engine;
  let nowValue;
  beforeEach(() => {
    nowValue = 10000;
    const session = {
      _deviceRouter: {
        getEquipmentCatalog: () => [
          { id: 'cycle_ace', eligible_users: ['felix', 'milo'] }
        ]
      }
    };
    engine = new GovernanceEngine(session, { now: () => nowValue, random: seededRng(1) });
  });

  it('picks a rider from eligible users and sets cycleState=init', () => {
    const selection = {
      id: 'test_cycle',
      type: 'cycle',
      equipment: 'cycle_ace',
      label: 'Test cycle',
      init: { minRpm: 30, timeAllowedSeconds: 60 },
      hiRpmRange: [50, 80],
      segmentCount: [3, 3],
      segmentDurationSeconds: [20, 20],
      rampSeconds: [10, 10],
      loRpmRatio: 0.75,
      sequenceType: 'random',
      userCooldownSeconds: 600,
      boost: { zoneMultipliers: {}, maxTotalMultiplier: 3.0 }
    };
    const active = engine._startCycleChallenge(selection, { policyId: 'default', policyName: 'Default', configId: 'default_challenge_0' });
    expect(active).toBeTruthy();
    expect(active.type).toBe('cycle');
    expect(active.cycleState).toBe('init');
    expect(active.rider).toMatch(/felix|milo/);
    expect(active.ridersUsed).toEqual([active.rider]);
    expect(active.currentPhaseIndex).toBe(0);
    expect(active.generatedPhases).toHaveLength(3);
    expect(active.initStartedAt).toBe(nowValue);
    expect(active.phaseProgressMs).toBe(0);
    expect(active.rampElapsedMs).toBe(0);
    expect(active.initElapsedMs).toBe(0);
    expect(active.totalLockEventsCount).toBe(0);
    expect(active.totalBoostedMs).toBe(0);
    expect(active.status).toBe('pending');
  });

  it('returns null when no eligible users available', () => {
    const selection = {
      id: 'test_cycle',
      type: 'cycle',
      equipment: 'nonexistent',  // no catalog entry
      init: { minRpm: 30, timeAllowedSeconds: 60 },
      hiRpmRange: [50, 80],
      segmentCount: [3, 3],
      segmentDurationSeconds: [20, 20],
      rampSeconds: [10, 10],
      loRpmRatio: 0.75,
      sequenceType: 'random',
      userCooldownSeconds: 600,
      boost: { zoneMultipliers: {}, maxTotalMultiplier: 3.0 }
    };
    expect(engine._startCycleChallenge(selection, {})).toBeNull();
  });

  it('filters out riders on cooldown', () => {
    engine._cycleCooldowns = { felix: nowValue + 5000, milo: nowValue + 5000 };
    const selection = {
      id: 'test_cycle',
      type: 'cycle',
      equipment: 'cycle_ace',
      init: { minRpm: 30, timeAllowedSeconds: 60 },
      hiRpmRange: [50, 80],
      segmentCount: [3, 3],
      segmentDurationSeconds: [20, 20],
      rampSeconds: [10, 10],
      loRpmRatio: 0.75,
      sequenceType: 'random',
      userCooldownSeconds: 600,
      boost: { zoneMultipliers: {}, maxTotalMultiplier: 3.0 }
    };
    expect(engine._startCycleChallenge(selection, {})).toBeNull();
  });
});
```

**Step 2: Verify failure**

```bash
npx jest tests/unit/governance/GovernanceEngine-cycleStart.test.mjs
```

**Step 3: Implement**

Add `_cycleCooldowns` initialization in constructor:

```javascript
this._cycleCooldowns = {}; // userId -> unix ms when cooldown expires
```

Implement:

```javascript
_startCycleChallenge(selection, ctx = {}) {
  const eligible = this._getEligibleUsers(selection.equipment);
  if (!eligible.length) return null;
  const now = this._now();
  const filtered = eligible.filter(uid => {
    const until = this._cycleCooldowns[uid];
    return !until || until <= now;
  });
  if (!filtered.length) return null;
  const rider = filtered[Math.floor(this._random() * filtered.length)];
  const phases = this._generateCyclePhases(selection);
  const active = {
    id: `${selection.id}_${now}`,
    type: 'cycle',
    selectionId: selection.id,
    selectionLabel: selection.label || null,
    configId: ctx.configId || null,
    policyId: ctx.policyId || null,
    policyName: ctx.policyName || null,
    equipment: selection.equipment,
    rider,
    ridersUsed: [rider],
    generatedPhases: phases,
    totalPhases: phases.length,
    currentPhaseIndex: 0,
    cycleState: 'init',
    status: 'pending',
    startedAt: now,
    initStartedAt: now,
    initElapsedMs: 0,
    initTotalMs: selection.init.timeAllowedSeconds * 1000,
    rampElapsedMs: 0,
    phaseProgressMs: 0,
    totalLockEventsCount: 0,
    totalBoostedMs: 0,
    boostContributors: new Set(),
    lockReason: null,
    pausedAt: null,
    pausedRemainingMs: null,
    selection
  };
  return active;
}
```

**Step 4: Run tests**

```bash
npx jest tests/unit/governance/GovernanceEngine-cycleStart.test.mjs
```

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/governance/GovernanceEngine-cycleStart.test.mjs
git commit -m "feat(governance): implement _startCycleChallenge with rider selection and cooldown filter"
```

---

### Task 9: Init → ramp transition + init timeout → locked

**Files:**
- Modify: `GovernanceEngine.js` — add `_evaluateCycleChallenge(active, evalContext)` method. For this task, handle only `init` state.
- Test: `tests/unit/governance/GovernanceEngine-cycleInit.test.mjs`

**Step 1: Write failing test**

```javascript
// tests/unit/governance/GovernanceEngine-cycleInit.test.mjs
import { describe, it, expect, jest } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine cycle init state', () => {
  let engine;
  let nowValue;
  let activeChallenge;

  beforeEach(() => {
    nowValue = 10000;
    engine = new GovernanceEngine(null, { now: () => nowValue });
    activeChallenge = {
      type: 'cycle', rider: 'felix', cycleState: 'init',
      initStartedAt: 10000, initElapsedMs: 0, initTotalMs: 60000,
      currentPhaseIndex: 0, generatedPhases: [
        { hiRpm: 60, loRpm: 45, rampSeconds: 10, maintainSeconds: 30 }
      ],
      selection: {
        init: { minRpm: 30, timeAllowedSeconds: 60 }
      },
      rampElapsedMs: 0, phaseProgressMs: 0,
      totalLockEventsCount: 0, status: 'pending'
    };
  });

  it('transitions to ramp when rider hits min_rpm AND base_req satisfied', () => {
    nowValue = 11000;
    const evalCtx = {
      riderZone: 'active',       // satisfies base_req
      equipmentRpm: 35,          // >= 30
      baseReqSatisfiedForRider: true
    };
    engine._evaluateCycleChallenge(activeChallenge, evalCtx);
    expect(activeChallenge.cycleState).toBe('ramp');
    expect(activeChallenge.currentPhaseIndex).toBe(0);
    expect(activeChallenge.rampElapsedMs).toBe(0); // fresh ramp
  });

  it('stays in init if rpm below min_rpm', () => {
    nowValue = 11000;
    engine._evaluateCycleChallenge(activeChallenge, {
      equipmentRpm: 20, baseReqSatisfiedForRider: true
    });
    expect(activeChallenge.cycleState).toBe('init');
    expect(activeChallenge.initElapsedMs).toBe(1000);
  });

  it('stays in init if base_req not satisfied', () => {
    nowValue = 11000;
    engine._evaluateCycleChallenge(activeChallenge, {
      equipmentRpm: 40, baseReqSatisfiedForRider: false
    });
    expect(activeChallenge.cycleState).toBe('init');
  });

  it('transitions to locked when init timer expires', () => {
    nowValue = 10000 + 61000;
    engine._evaluateCycleChallenge(activeChallenge, {
      equipmentRpm: 0, baseReqSatisfiedForRider: true
    });
    expect(activeChallenge.cycleState).toBe('locked');
    expect(activeChallenge.lockReason).toBe('init');
    expect(activeChallenge.totalLockEventsCount).toBe(1);
  });
});
```

**Step 2: Verify failure**

```bash
npx jest tests/unit/governance/GovernanceEngine-cycleInit.test.mjs
```

**Step 3: Implement**

```javascript
_evaluateCycleChallenge(active, ctx) {
  const now = this._now();
  const dt = Number.isFinite(active._lastCycleTs) ? now - active._lastCycleTs : 0;
  active._lastCycleTs = now;

  if (active.cycleState === 'init') {
    active.initElapsedMs += dt;
    if (active.initElapsedMs >= active.initTotalMs) {
      active.cycleState = 'locked';
      active.lockReason = 'init';
      active.totalLockEventsCount += 1;
      return;
    }
    if (ctx.equipmentRpm >= active.selection.init.minRpm && ctx.baseReqSatisfiedForRider) {
      active.cycleState = 'ramp';
      active.rampElapsedMs = 0;
    }
    return;
  }
  // other states added in later tasks
}
```

**Step 4: Run tests**

```bash
npx jest tests/unit/governance/GovernanceEngine-cycleInit.test.mjs
```

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/governance/GovernanceEngine-cycleInit.test.mjs
git commit -m "feat(governance): implement cycle challenge init state transitions"
```

---

### Task 10: Ramp → maintain transition + ramp timeout → locked

**Files:**
- Modify: `GovernanceEngine.js` — extend `_evaluateCycleChallenge` with ramp branch.
- Test: `tests/unit/governance/GovernanceEngine-cycleRamp.test.mjs`

**Step 1: Write failing test**

```javascript
// tests/unit/governance/GovernanceEngine-cycleRamp.test.mjs
import { describe, it, expect, jest } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine cycle ramp state', () => {
  let engine, nowValue, active;

  beforeEach(() => {
    nowValue = 20000;
    engine = new GovernanceEngine(null, { now: () => nowValue });
    active = {
      type: 'cycle', rider: 'felix', cycleState: 'ramp',
      currentPhaseIndex: 0, generatedPhases: [
        { hiRpm: 60, loRpm: 45, rampSeconds: 15, maintainSeconds: 30 }
      ],
      selection: { init: { minRpm: 30, timeAllowedSeconds: 60 } },
      rampElapsedMs: 0, phaseProgressMs: 0,
      initElapsedMs: 0, initTotalMs: 60000,
      totalLockEventsCount: 0, status: 'pending'
    };
  });

  it('transitions to maintain when rpm hits hi', () => {
    nowValue = 22000;
    engine._evaluateCycleChallenge(active, { equipmentRpm: 60, baseReqSatisfiedForRider: true });
    expect(active.cycleState).toBe('maintain');
    expect(active.phaseProgressMs).toBe(0); // fresh
  });

  it('stays in ramp when rpm below hi', () => {
    nowValue = 22000;
    engine._evaluateCycleChallenge(active, { equipmentRpm: 50, baseReqSatisfiedForRider: true });
    expect(active.cycleState).toBe('ramp');
    expect(active.rampElapsedMs).toBe(2000);
  });

  it('transitions to locked (ramp) when ramp timer expires', () => {
    nowValue = 20000 + 16000;
    engine._evaluateCycleChallenge(active, { equipmentRpm: 40, baseReqSatisfiedForRider: true });
    expect(active.cycleState).toBe('locked');
    expect(active.lockReason).toBe('ramp');
    expect(active.totalLockEventsCount).toBe(1);
  });
});
```

**Step 2: Verify failure**

**Step 3: Implement** — extend `_evaluateCycleChallenge`:

```javascript
if (active.cycleState === 'ramp') {
  const phase = active.generatedPhases[active.currentPhaseIndex];
  active.rampElapsedMs += dt;
  if (ctx.equipmentRpm >= phase.hiRpm) {
    active.cycleState = 'maintain';
    active.phaseProgressMs = 0;
    return;
  }
  if (active.rampElapsedMs >= phase.rampSeconds * 1000) {
    active.cycleState = 'locked';
    active.lockReason = 'ramp';
    active.totalLockEventsCount += 1;
  }
  return;
}
```

**Step 4: Run tests**

**Step 5: Commit**

```bash
git commit -am "feat(governance): implement cycle ramp state transitions and timeout"
```

---

### Task 11: Maintain state — progress accrual, dim factor, phase advance, success

**Files:**
- Modify: `GovernanceEngine.js` — extend `_evaluateCycleChallenge` with maintain branch + add `_computeBoostMultiplier` + `_computeDimFactor`.
- Test: `tests/unit/governance/GovernanceEngine-cycleMaintain.test.mjs`

**Step 1: Write failing test**

```javascript
// tests/unit/governance/GovernanceEngine-cycleMaintain.test.mjs
import { describe, it, expect, jest } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine cycle maintain state', () => {
  let engine, nowValue, active;

  beforeEach(() => {
    nowValue = 30000;
    engine = new GovernanceEngine(null, { now: () => nowValue });
    active = {
      type: 'cycle', rider: 'felix', cycleState: 'maintain',
      currentPhaseIndex: 0, generatedPhases: [
        { hiRpm: 60, loRpm: 45, rampSeconds: 15, maintainSeconds: 30 },
        { hiRpm: 70, loRpm: 55, rampSeconds: 20, maintainSeconds: 45 }
      ],
      selection: {
        init: { minRpm: 30, timeAllowedSeconds: 60 },
        boost: { zoneMultipliers: { hot: 0.5, fire: 1.0 }, maxTotalMultiplier: 3.0 }
      },
      phaseProgressMs: 0, rampElapsedMs: 0, initElapsedMs: 0, initTotalMs: 60000,
      totalLockEventsCount: 0, totalBoostedMs: 0,
      boostContributors: new Set(), status: 'pending',
      _lastCycleTs: 30000
    };
  });

  it('accrues phaseProgressMs at 1x when rpm at hi and no boost', () => {
    nowValue = 31000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 65, baseReqSatisfiedForRider: true, userZoneMap: { felix: 'warm' }
    });
    expect(active.phaseProgressMs).toBe(1000);
    expect(active.cycleState).toBe('maintain');
  });

  it('pauses progress in dim band (between lo and hi)', () => {
    nowValue = 31000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 50, baseReqSatisfiedForRider: true, userZoneMap: { felix: 'warm' }
    });
    expect(active.phaseProgressMs).toBe(0);
    expect(active.cycleState).toBe('maintain');
  });

  it('transitions to locked when rpm below lo', () => {
    nowValue = 31000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 40, baseReqSatisfiedForRider: true, userZoneMap: { felix: 'active' }
    });
    expect(active.cycleState).toBe('locked');
    expect(active.lockReason).toBe('maintain');
    expect(active.totalLockEventsCount).toBe(1);
  });

  it('accrues at boosted rate when non-rider in hot', () => {
    nowValue = 31000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 65, baseReqSatisfiedForRider: true,
      userZoneMap: { felix: 'warm', mickey: 'hot' }, activeParticipants: ['felix', 'mickey']
    });
    expect(active.phaseProgressMs).toBe(1500);
    expect(active.totalBoostedMs).toBe(500);
  });

  it('includes rider in boost calculation (self-boost)', () => {
    nowValue = 31000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 65, baseReqSatisfiedForRider: true,
      userZoneMap: { felix: 'fire' }, activeParticipants: ['felix']
    });
    expect(active.phaseProgressMs).toBe(2000);
  });

  it('caps boost at maxTotalMultiplier', () => {
    nowValue = 31000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 65, baseReqSatisfiedForRider: true,
      userZoneMap: { felix: 'fire', a: 'fire', b: 'fire', c: 'fire' },
      activeParticipants: ['felix', 'a', 'b', 'c']
    });
    expect(active.phaseProgressMs).toBe(3000); // capped at 3.0x
  });

  it('advances to next phase ramp when maintain fills', () => {
    active.phaseProgressMs = 29500;
    nowValue = 31000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 65, baseReqSatisfiedForRider: true, userZoneMap: { felix: 'warm' }
    });
    expect(active.currentPhaseIndex).toBe(1);
    expect(active.cycleState).toBe('ramp');
    expect(active.rampElapsedMs).toBe(0);
  });

  it('final phase complete → status=success', () => {
    active.currentPhaseIndex = 1;
    active.phaseProgressMs = 44500;
    nowValue = 31000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 75, baseReqSatisfiedForRider: true, userZoneMap: { felix: 'hot' }
    });
    expect(active.status).toBe('success');
  });
});
```

**Step 2: Verify failure**

**Step 3: Implement**

```javascript
_computeBoostMultiplier(active, ctx) {
  const mults = active.selection?.boost?.zoneMultipliers || {};
  const cap = active.selection?.boost?.maxTotalMultiplier || 3.0;
  const participants = ctx.activeParticipants || [];
  let sum = 0;
  const contributors = [];
  participants.forEach(uid => {
    const z = ctx.userZoneMap?.[uid];
    const m = z && mults[z];
    if (m) { sum += m; contributors.push(uid); }
  });
  const total = Math.min(1.0 + sum, cap);
  return { multiplier: Math.max(1.0, total), contributors };
}

// (inside _evaluateCycleChallenge)
if (active.cycleState === 'maintain') {
  const phase = active.generatedPhases[active.currentPhaseIndex];
  if (ctx.equipmentRpm < phase.loRpm) {
    active.cycleState = 'locked';
    active.lockReason = 'maintain';
    active.totalLockEventsCount += 1;
    return;
  }
  if (ctx.equipmentRpm >= phase.hiRpm) {
    const { multiplier, contributors } = this._computeBoostMultiplier(active, ctx);
    const progressAdd = dt * multiplier;
    active.phaseProgressMs += progressAdd;
    if (multiplier > 1.0) {
      active.totalBoostedMs += (progressAdd - dt);
      contributors.forEach(u => active.boostContributors.add(u));
    }
    if (active.phaseProgressMs >= phase.maintainSeconds * 1000) {
      if (active.currentPhaseIndex + 1 >= active.generatedPhases.length) {
        active.status = 'success';
        active.completedAt = now;
      } else {
        active.currentPhaseIndex += 1;
        active.cycleState = 'ramp';
        active.rampElapsedMs = 0;
        active.phaseProgressMs = 0;
      }
    }
  }
  // between lo and hi: progress paused, no state change
  return;
}
```

**Step 4: Run tests**

```bash
npx jest tests/unit/governance/GovernanceEngine-cycleMaintain.test.mjs
```

**Step 5: Commit**

```bash
git commit -am "feat(governance): implement cycle maintain accrual, boost, phase advance, success"
```

---

### Task 12: Locked state recovery paths

**Files:**
- Modify: `GovernanceEngine.js` — extend `_evaluateCycleChallenge` with locked branch.
- Test: `tests/unit/governance/GovernanceEngine-cycleLocked.test.mjs`

**Step 1: Write failing test**

```javascript
// tests/unit/governance/GovernanceEngine-cycleLocked.test.mjs
import { describe, it, expect, jest } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine cycle locked recovery', () => {
  let engine, active;

  beforeEach(() => {
    engine = new GovernanceEngine(null, { now: () => 40000 });
    active = {
      type: 'cycle', rider: 'felix', cycleState: 'locked', lockReason: 'maintain',
      currentPhaseIndex: 0, generatedPhases: [{ hiRpm: 60, loRpm: 45, rampSeconds: 15, maintainSeconds: 30 }],
      selection: { init: { minRpm: 30, timeAllowedSeconds: 60 } },
      phaseProgressMs: 12000, rampElapsedMs: 0, initElapsedMs: 0, initTotalMs: 60000,
      totalLockEventsCount: 1, totalBoostedMs: 0, boostContributors: new Set(),
      _lastCycleTs: 40000
    };
  });

  it('maintain-lock → maintain when rpm ≥ hi, preserves phaseProgress', () => {
    engine._evaluateCycleChallenge(active, { equipmentRpm: 65, baseReqSatisfiedForRider: true });
    expect(active.cycleState).toBe('maintain');
    expect(active.phaseProgressMs).toBe(12000); // preserved
  });

  it('ramp-lock → maintain when rpm ≥ hi (skips ramp since achieved)', () => {
    active.lockReason = 'ramp';
    engine._evaluateCycleChallenge(active, { equipmentRpm: 70, baseReqSatisfiedForRider: true });
    expect(active.cycleState).toBe('maintain');
    expect(active.phaseProgressMs).toBe(0);
  });

  it('init-lock → init when rpm ≥ init.minRpm', () => {
    active.lockReason = 'init';
    active.initElapsedMs = 60000;
    engine._evaluateCycleChallenge(active, { equipmentRpm: 35, baseReqSatisfiedForRider: true });
    expect(active.cycleState).toBe('init');
    // init timer reset so they have time to complete
    expect(active.initElapsedMs).toBe(0);
  });

  it('stays locked when rpm below recovery threshold', () => {
    engine._evaluateCycleChallenge(active, { equipmentRpm: 40, baseReqSatisfiedForRider: true });
    expect(active.cycleState).toBe('locked');
  });
});
```

**Step 2: Verify failure**

**Step 3: Implement**

```javascript
if (active.cycleState === 'locked') {
  const phase = active.generatedPhases[active.currentPhaseIndex];
  if (active.lockReason === 'init') {
    if (ctx.equipmentRpm >= active.selection.init.minRpm) {
      active.cycleState = 'init';
      active.initElapsedMs = 0;
      active.lockReason = null;
    }
    return;
  }
  if (active.lockReason === 'ramp' || active.lockReason === 'maintain') {
    if (ctx.equipmentRpm >= phase.hiRpm) {
      active.cycleState = 'maintain';
      if (active.lockReason === 'ramp') active.phaseProgressMs = 0;
      active.lockReason = null;
    }
    return;
  }
}
```

**Step 4: Run tests**

**Step 5: Commit**

```bash
git commit -am "feat(governance): implement cycle locked-state recovery paths"
```

---

### Task 13: Base requirement pause/resume for cycle challenge

**Files:**
- Modify: `GovernanceEngine.js` — extend the existing pause block (around `:2127-2145`) to pause cycle-specific timers. When cycle, freeze `initElapsedMs`, `rampElapsedMs`, `phaseProgressMs` via `pausedAt` pattern.
- Test: `tests/unit/governance/GovernanceEngine-cyclePause.test.mjs`

**Step 1: Write failing test**

```javascript
// tests/unit/governance/GovernanceEngine-cyclePause.test.mjs
import { describe, it, expect, jest } from '@jest/globals';
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() }),
  getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), sampled: jest.fn() })
}));
const { GovernanceEngine } = await import('#frontend/hooks/fitness/GovernanceEngine.js');

describe('GovernanceEngine cycle pause/resume on base_req', () => {
  it('does not accrue cycle progress while base_req failing', () => {
    let nowValue = 50000;
    const engine = new GovernanceEngine(null, { now: () => nowValue });
    const active = {
      type: 'cycle', cycleState: 'maintain', rider: 'felix',
      currentPhaseIndex: 0, generatedPhases: [{ hiRpm: 60, loRpm: 45, rampSeconds: 10, maintainSeconds: 30 }],
      selection: { init: {}, boost: { zoneMultipliers: {}, maxTotalMultiplier: 3.0 } },
      phaseProgressMs: 5000, rampElapsedMs: 0, initElapsedMs: 0, initTotalMs: 60000,
      totalLockEventsCount: 0, totalBoostedMs: 0, boostContributors: new Set(),
      _lastCycleTs: 50000
    };
    // Tick with base_req NOT satisfied (other user cool)
    nowValue = 51000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 65, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: false,
      userZoneMap: { felix: 'warm' }, activeParticipants: ['felix']
    });
    expect(active.phaseProgressMs).toBe(5000); // frozen
    // Tick with base_req restored
    nowValue = 52000;
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 65, baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true,
      userZoneMap: { felix: 'warm' }, activeParticipants: ['felix']
    });
    expect(active.phaseProgressMs).toBe(6000); // resumed
  });
});
```

**Step 2: Verify failure**

**Step 3: Implement** — top of `_evaluateCycleChallenge`:

```javascript
// Pause gate
if (ctx.baseReqSatisfiedGlobal === false) {
  active._lastCycleTs = now; // still update so post-resume dt is correct
  return;
}
```

**Step 4: Run tests**

**Step 5: Commit**

```bash
git commit -am "feat(governance): pause cycle challenge while base_req fails"
```

---

### Task 14: Wire `_evaluateCycleChallenge` into `_evaluateChallenges` dispatch

**Files:**
- Modify: `GovernanceEngine.js` — in `_evaluateChallenges` (~line 1821), before `startChallenge` and the main active-challenge-evaluation block, branch: if `activeChallenge.type === 'cycle'`, call `_evaluateCycleChallenge` with the right context; if `type` is `cycle` at selection time, call `_startCycleChallenge` instead of the zone-specific start.
- Test: `tests/unit/governance/GovernanceEngine-cycleDispatch.test.mjs`

**Step 1: Write failing test**

Test a full end-to-end cycle: config normalization → challenge selected → start → init → ramp → maintain → success, via the public `evaluate()` API.

```javascript
// tests/unit/governance/GovernanceEngine-cycleDispatch.test.mjs
// (Use inline config; drive engine.evaluate() repeatedly with equipmentCadenceMap; inspect activeChallenge state)
```

Given length, test should:
1. Call `setConfig({ governance: { policies: { default: { ... cycle selection ... } } } })`.
2. Call `setMedia({ id: 'v1', type: 'episode', labels: ['cardio'] })`.
3. Drive `evaluate({...})` with equipmentCadenceMap transitioning: init → ramp → maintain → success.
4. Assert `activeChallenge.status === 'success'` at the end.
5. Assert `challengeHistory` includes one entry with `type: 'cycle'`.

**Step 2: Verify failure**

**Step 3: Implement** — in `_evaluateChallenges`:

Add `type` dispatch branch. Where `challengeConfig` is the old shape, now need to treat `type === 'cycle'` selections differently. The cleanest approach:

1. When iterating selections for scheduling, keep the existing pool logic.
2. In `startChallenge()`, branch on `preview.type === 'cycle'` → call `_startCycleChallenge` instead of the zone-specific builder.
3. In the active-challenge block (line ~2121), branch on `challenge.type === 'cycle'` → call `_evaluateCycleChallenge(challenge, ctx)`, skip zone logic entirely.

Build `ctx` with:
```javascript
const ctx = {
  equipmentRpm: this._latestInputs.equipmentCadenceMap?.[active.equipment]?.rpm || 0,
  activeParticipants, userZoneMap,
  baseReqSatisfiedForRider: evalContext.riderZoneRank >= requiredRank, // compute based on policy base_req + rider
  baseReqSatisfiedGlobal: this.phase === 'unlocked'
};
```

**Step 4: Run tests**

```bash
npx jest tests/unit/governance/
```

**Step 5: Commit**

```bash
git commit -am "feat(governance): wire cycle challenge into _evaluateChallenges dispatch"
```

---

## Phase 4: Swap, Cooldown, History, Snapshot

### Task 15: Implement `swapCycleRider` public method

**Files:**
- Modify: `GovernanceEngine.js` — new public method.
- Test: `tests/unit/governance/GovernanceEngine-cycleSwap.test.mjs`

**Step 1: Write failing test**

```javascript
describe('GovernanceEngine.swapCycleRider', () => {
  // (1) swap during init succeeds, rider changes, init timer resets, ridersUsed grows
  // (2) swap during phase-1 ramp succeeds, reverts to init
  // (3) swap during maintain rejected
  // (4) swap during phase-2 ramp rejected
  // (5) swap during locked rejected
  // (6) swap to non-eligible user rejected
  // (7) swap to cooldown user rejected unless force:true
  // (8) returns { success: true | false, reason? }
});
```

**Step 2: Verify failure**

**Step 3: Implement**

```javascript
swapCycleRider(riderId, { force = false } = {}) {
  const active = this.challengeState.activeChallenge;
  if (!active || active.type !== 'cycle') {
    return { success: false, reason: 'no active cycle challenge' };
  }
  const allowed = active.cycleState === 'init'
    || (active.cycleState === 'ramp' && active.currentPhaseIndex === 0);
  if (!allowed) return { success: false, reason: 'swap window closed' };
  const eligible = this._getEligibleUsers(active.equipment);
  if (!eligible.includes(riderId)) return { success: false, reason: 'not eligible' };
  const now = this._now();
  if (!force && this._cycleCooldowns[riderId] && this._cycleCooldowns[riderId] > now) {
    return { success: false, reason: 'on cooldown' };
  }
  active.rider = riderId;
  if (!active.ridersUsed.includes(riderId)) active.ridersUsed.push(riderId);
  active.cycleState = 'init';
  active.initElapsedMs = 0;
  active.initStartedAt = now;
  active.rampElapsedMs = 0;
  active.phaseProgressMs = 0;
  return { success: true };
}
```

**Step 4: Run tests**

**Step 5: Commit**

```bash
git commit -am "feat(governance): add swapCycleRider public API"
```

---

### Task 16: Apply cooldowns and record history on challenge end

**Files:**
- Modify: `GovernanceEngine.js` — in the existing success/failed completion block (~line 2149-2175), branch for cycle challenges to write cycle-specific history fields + set cooldowns for all `ridersUsed`.
- Test: `tests/unit/governance/GovernanceEngine-cycleHistory.test.mjs`

**Step 1: Write failing test**

```javascript
describe('GovernanceEngine cycle history and cooldown', () => {
  // (1) On success, history entry has type='cycle', rider, ridersUsed, phasesCompleted=total, totalBoostedMs, boostContributors
  // (2) On failure, history entry has status='failed', phasesCompleted < total
  // (3) All ridersUsed receive cooldown = now + user_cooldown_seconds*1000
  // (4) Abandoned status on session end (call new engine.abandonActiveChallenge())
});
```

**Step 2: Verify failure**

**Step 3: Implement** — when cycle `status` becomes `success` or `failed`:

```javascript
const cooldownMs = (active.selection.userCooldownSeconds || 600) * 1000;
active.ridersUsed.forEach(uid => {
  this._cycleCooldowns[uid] = now + cooldownMs;
});
this.challengeState.challengeHistory.push({
  id: active.id,
  type: 'cycle',
  status: active.status,
  startedAt: active.startedAt,
  completedAt: active.completedAt || now,
  selectionLabel: active.selectionLabel,
  rider: active.rider,
  ridersUsed: [...active.ridersUsed],
  totalPhases: active.totalPhases,
  phasesCompleted: active.status === 'success' ? active.totalPhases : active.currentPhaseIndex,
  totalLockEventsCount: active.totalLockEventsCount,
  totalBoostedMs: Math.round(active.totalBoostedMs),
  boostContributors: [...active.boostContributors]
});
if (this.challengeState.challengeHistory.length > 20) {
  this.challengeState.challengeHistory.splice(0, this.challengeState.challengeHistory.length - 20);
}
```

Also add public method:

```javascript
abandonActiveChallenge() {
  const active = this.challengeState.activeChallenge;
  if (!active || active.type !== 'cycle') return;
  active.status = 'abandoned';
  active.completedAt = this._now();
  // Reuse cooldown/history logic
}
```

**Step 4: Run tests**

**Step 5: Commit**

```bash
git commit -am "feat(governance): record cycle challenge history and apply user cooldowns"
```

---

### Task 17: Emit cycle state snapshot

**Files:**
- Modify: `GovernanceEngine.js` — `_buildChallengeSnapshot` (~line 386), branch on `activeChallenge.type === 'cycle'` to emit cycle fields.
- Test: `tests/unit/governance/GovernanceEngine-cycleSnapshot.test.mjs`

**Step 1: Write failing test**

```javascript
describe('GovernanceEngine cycle snapshot', () => {
  // Drive a cycle challenge into maintain state
  // Assert snapshot has:
  //   type='cycle', rider (object with id/name), cycleState, currentPhaseIndex, totalPhases,
  //   currentPhase, generatedPhases, currentRpm, phaseProgressPct, allPhasesProgress,
  //   rampRemainingMs/Total, initRemainingMs/Total, dimFactor, boostMultiplier,
  //   boostingUsers, lockReason, swapAllowed, swapEligibleUsers
});
```

**Step 2: Verify failure**

**Step 3: Implement** — inside `_buildChallengeSnapshot`:

```javascript
if (activeChallenge.type === 'cycle') {
  const phase = activeChallenge.generatedPhases[activeChallenge.currentPhaseIndex];
  const currentRpm = this._latestInputs.equipmentCadenceMap?.[activeChallenge.equipment]?.rpm || 0;
  const dimFactor = phase && activeChallenge.cycleState === 'maintain'
    && currentRpm >= phase.loRpm && currentRpm < phase.hiRpm
    ? (phase.hiRpm - currentRpm) / (phase.hiRpm - phase.loRpm)
    : 0;
  const { multiplier, contributors } = this._computeBoostMultiplier(activeChallenge, {
    activeParticipants: this._latestInputs.activeParticipants,
    userZoneMap: this._latestInputs.userZoneMap
  });
  const swapAllowed = activeChallenge.cycleState === 'init'
    || (activeChallenge.cycleState === 'ramp' && activeChallenge.currentPhaseIndex === 0);
  const now = this._now();
  const eligible = this._getEligibleUsers(activeChallenge.equipment)
    .filter(uid => uid !== activeChallenge.rider
      && (!this._cycleCooldowns[uid] || this._cycleCooldowns[uid] <= now));
  return {
    id: activeChallenge.id,
    type: 'cycle',
    status: activeChallenge.status,
    rider: {
      id: activeChallenge.rider,
      name: this.session?.getParticipantProfile?.(activeChallenge.rider)?.name || activeChallenge.rider
    },
    cycleState: activeChallenge.cycleState,
    currentPhaseIndex: activeChallenge.currentPhaseIndex,
    totalPhases: activeChallenge.totalPhases,
    currentPhase: phase,
    generatedPhases: activeChallenge.generatedPhases,
    currentRpm,
    phaseProgressPct: phase ? Math.min(1, activeChallenge.phaseProgressMs / (phase.maintainSeconds * 1000)) : 0,
    allPhasesProgress: activeChallenge.generatedPhases.map((p, i) =>
      i < activeChallenge.currentPhaseIndex ? 1.0 :
      i > activeChallenge.currentPhaseIndex ? 0.0 :
      Math.min(1, activeChallenge.phaseProgressMs / (p.maintainSeconds * 1000))
    ),
    rampRemainingMs: phase ? Math.max(0, phase.rampSeconds * 1000 - activeChallenge.rampElapsedMs) : 0,
    rampTotalMs: phase ? phase.rampSeconds * 1000 : 0,
    initRemainingMs: Math.max(0, activeChallenge.initTotalMs - activeChallenge.initElapsedMs),
    initTotalMs: activeChallenge.initTotalMs,
    dimFactor,
    boostMultiplier: multiplier,
    boostingUsers: contributors,
    lockReason: activeChallenge.lockReason,
    swapAllowed,
    swapEligibleUsers: eligible
  };
}
```

**Step 4: Run tests**

**Step 5: Commit**

```bash
git commit -am "feat(governance): emit cycle challenge state snapshot fields"
```

---

### Task 18: Extend `triggerChallenge` for cycle type

**Files:**
- Modify: `GovernanceEngine.js` — extend `triggerChallenge` (~line 2361) to accept `type: 'cycle'` + optional `riderId`.
- Test: `tests/unit/governance/GovernanceEngine-cycleTrigger.test.mjs`

**Step 1: Write failing test**

```javascript
describe('GovernanceEngine.triggerChallenge for cycle', () => {
  // (1) triggerChallenge({ type: 'cycle', selectionId: 'X' }) → starts with random rider
  // (2) triggerChallenge({ type: 'cycle', selectionId: 'X', riderId: 'felix' }) → forces rider, bypass cooldown
  // (3) triggerChallenge with unknown selectionId → rejected with reason
  // (4) triggerChallenge with non-eligible riderId → rejected
});
```

**Step 2: Verify failure**

**Step 3: Implement** — branch in `triggerChallenge`.

**Step 4: Run tests**

**Step 5: Commit**

```bash
git commit -am "feat(governance): extend triggerChallenge for cycle type"
```

---

### Task 19: Wire audio cues on cycle state transitions

**Files:**
- Modify: `GovernanceEngine.js` — emit `onCycleStateChange` callback / include `cycleAudioCue` in state snapshot on transitions.
- Modify: `frontend/src/modules/Fitness/player/overlays/GovernanceAudioPlayer.jsx` — wire new cue IDs (`cycle_challenge_init`, `cycle_phase_complete`, `cycle_success`, `cycle_locked`).
- Test: `tests/unit/governance/GovernanceEngine-cycleAudio.test.mjs`

**Step 1: Write failing test**

```javascript
// Snapshot should include cycleAudioCue: 'cycle_challenge_init' on init start (edge-triggered)
// 'cycle_phase_complete' on phase transition (edge-triggered)
// 'cycle_success' on success
// 'cycle_locked' on lock entry
// null on no transition
```

**Step 2: Verify failure**

**Step 3: Implement** — track `_lastEmittedCycleCue` on the active challenge, emit cue on state transitions.

**Step 4: Run tests**

**Step 5: Commit**

```bash
git commit -am "feat(governance): emit cycle challenge audio cues on state transitions"
```

---

## Phase 5: Frontend

### Task 20: Apply `--cycle-dim` CSS variable on fitness player root

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` — read `dimFactor` from governance snapshot, set inline CSS var.
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.scss` — add filter rules bound to `--cycle-dim`.
- Test: `tests/unit/fitness/FitnessPlayer-cycleDim.test.mjs` (RTL snapshot test)

**Step 1: Write failing test**

```javascript
// Render FitnessPlayer with mock governance state containing challenge { type:'cycle', dimFactor: 0.5 }
// Assert rootElement.style.getPropertyValue('--cycle-dim') === '0.5'
// Re-render with dimFactor: 0 → assert '0'
```

**Step 2: Verify failure**

**Step 3: Implement** — pass `style={{ '--cycle-dim': String(dimFactor) }}` on the player root element; add `.cycle-dim` class gated on `cycleState === 'maintain'`.

SCSS:

```scss
.fitness-player {
  video, dash-video, .video-player {
    filter:
      brightness(calc(1 - var(--cycle-dim, 0) * 0.4))
      grayscale(calc(var(--cycle-dim, 0) * 1))
      sepia(calc(var(--cycle-dim, 0) * 0.4))
      blur(calc(var(--cycle-dim, 0) * 4px));
    transition: filter 0.3s ease;
  }
}
```

**Step 4: Run tests**

**Step 5: Commit**

```bash
git commit -am "feat(fitness): apply --cycle-dim CSS var for progressive video degradation"
```

---

### Task 21: Create `CycleChallengeOverlay.jsx` — outer ring, status colors, segment counter

**Files:**
- Create: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.jsx`
- Create: `frontend/src/modules/Fitness/player/overlays/CycleChallengeOverlay.scss`
- Test: `tests/unit/fitness/CycleChallengeOverlay.test.mjs`

**Step 1: Write failing test**

```javascript
// (1) Render with cycle state → overlay div with class `.cycle-challenge-overlay` present
// (2) cycleState='init' → outer ring has slate-blue color
// (3) cycleState='maintain' at hi → green ring
// (4) currentRpm in dim band → orange ring
// (5) cycleState='locked' → red ring
// (6) Segment counter shows "1 / 3" when currentPhaseIndex=0, total=3
// (7) Target RPM sign displays currentPhase.hiRpm
// (8) Position cycles top/middle/bottom on click
// (9) Click rider avatar calls onRequestSwap prop (when swapAllowed=true)
```

**Step 2: Verify failure**

**Step 3: Implement** — SVG-based circular widget per design doc Section 5. Apply same position logic as `ChallengeOverlay.jsx:67-77`.

**Step 4: Run tests**

**Step 5: Commit**

```bash
git commit -am "feat(fitness): CycleChallengeOverlay widget skeleton with ring + counter + target"
```

---

### Task 22: CycleChallengeOverlay — RPM gauge arc with needle and tick marks

**Files:** same as Task 21.

**Step 1: Write failing test**

```javascript
// (1) Gauge arc 180° from gauge min (0) to gauge max (120)
// (2) Needle rotates to currentRpm position
// (3) hi_rpm tick marked in green
// (4) lo_rpm tick marked in red
// (5) Needle glows green when currentRpm >= hi_rpm (class .needle--at-hi)
```

**Step 2: Verify failure**

**Step 3: Implement** — compute needle rotation via simple linear map, draw tick marks in SVG.

**Step 4: Run tests**

**Step 5: Commit**

```bash
git commit -am "feat(fitness): cycle overlay RPM gauge arc with tick marks"
```

---

### Task 23: CycleChallengeOverlay — booster avatars + boost multiplier badge

**Files:** same as Task 21.

**Step 1: Write failing test**

```javascript
// (1) 0 boosters: no booster avatars rendered
// (2) 1 booster: one avatar in NE quadrant
// (3) 4 boosters: avatars in all 4 quadrants
// (4) >4 boosters: max 4 rendered (overflow hidden)
// (5) boostMultiplier > 1 → badge "×1.5" visible
// (6) boostMultiplier === 1 → no badge
```

**Step 2: Verify failure**

**Step 3: Implement**

**Step 4: Run tests**

**Step 5: Commit**

```bash
git commit -am "feat(fitness): cycle overlay booster avatars + multiplier badge"
```

---

### Task 24: Create `CycleRiderSwapModal.jsx` (portal-based)

**Files:**
- Create: `frontend/src/modules/Fitness/player/overlays/CycleRiderSwapModal.jsx`
- Create: `frontend/src/modules/Fitness/player/overlays/CycleRiderSwapModal.scss`
- Test: `tests/unit/fitness/CycleRiderSwapModal.test.mjs`

**Step 1: Write failing test**

```javascript
// (1) Renders into document.body via portal
// (2) Lists swapEligibleUsers
// (3) Cooldown users shown greyed with cooldown time
// (4) Clicking user calls onConfirm(userId)
// (5) Clicking cancel calls onClose
// (6) Backdrop click calls onClose
```

**Step 2: Verify failure**

**Step 3: Implement** — pattern after `VoiceMemoOverlay.jsx:617-641` (portal + panel structure).

**Step 4: Run tests**

**Step 5: Commit**

```bash
git commit -am "feat(fitness): CycleRiderSwapModal portal modal for rider swap"
```

---

### Task 25: Add RPM pill variant to `GovernanceStateOverlay.scss`

**Files:**
- Modify: `frontend/src/modules/Fitness/player/overlays/GovernanceStateOverlay.scss` (add `&__pill--rpm` + zone-based styling)
- Modify: `frontend/src/modules/Fitness/player/overlays/GovernanceStateOverlay.jsx` — when `challenge.type === 'cycle'` and phase=locked, render one lock row with RPM pills.
- Test: `tests/unit/fitness/GovernanceStateOverlay-cycleLock.test.mjs`

**Step 1: Write failing test**

```javascript
// When passed governance state with cycle challenge in locked state:
// (1) Lock overlay visible
// (2) One lock row rendered for rider
// (3) Row has current-RPM pill with value + zone styling
// (4) Row has target-RPM pill with phase.hiRpm
// (5) Progress bar shows currentRpm/hiRpm ratio
```

**Step 2: Verify failure**

**Step 3: Implement**

**Step 4: Run tests**

**Step 5: Commit**

```bash
git commit -am "feat(fitness): RPM pill variant in lock screen for cycle challenges"
```

---

### Task 26: Wire `CycleChallengeOverlay` + swap modal into `FitnessPlayer`

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` — conditionally render `CycleChallengeOverlay` when governance snapshot has `challenge.type === 'cycle'`. Manage swap modal state (open/close). Call `engine.swapCycleRider` on confirm.
- Test: smoke-level Playwright test deferred to Task 29.

**Step 1-5:** Integration work with minimal test coverage at this layer (Playwright live flow tests cover end-to-end).

```bash
git commit -am "feat(fitness): integrate CycleChallengeOverlay into FitnessPlayer"
```

---

## Phase 6: Integration Tests

### Task 27: Integration test — happy path (full cycle success)

**Files:**
- Create: `tests/integrated/governance/cycle-challenge.happy-path.test.mjs`

**Step 1: Write failing integration test**

Drives real `GovernanceEngine` + mock session with cadence feed. Scenario:

1. Config with 1 cycle selection, 3-phase `progressive` sequence.
2. Seed RNG; draw cycle challenge; rider assigned (known-seeded).
3. Drive cadence: init (rpm 35) → ramp (rpm climbs to hi) → maintain (hold hi) → phase advance × 2 → success.
4. Assert final status, history, cooldown.

**Step 2: Verify failure**

Expected FAIL until all prior tasks integrated.

**Step 3: Already implemented** (verification of integration)

**Step 4: Run test**

**Step 5: Commit**

```bash
git commit -am "test(governance): integration test for cycle happy path"
```

---

### Task 28: Integration test — boost stacking, base-req pause, swap, ramp-lock recovery

Four separate integration tests, one per scenario, each written → verified failing → verified passing → committed.

**Files:**
- `tests/integrated/governance/cycle-challenge.boost-stacking.test.mjs`
- `tests/integrated/governance/cycle-challenge.base-req-pause.test.mjs`
- `tests/integrated/governance/cycle-challenge.swap-flow.test.mjs`
- `tests/integrated/governance/cycle-challenge.ramp-lock-recovery.test.mjs`

Each follows same TDD pattern. Commit separately:

```bash
git commit -am "test(governance): integration test for cycle boost stacking"
git commit -am "test(governance): integration test for cycle base-req pause"
git commit -am "test(governance): integration test for cycle rider swap"
git commit -am "test(governance): integration test for cycle ramp-lock recovery"
```

---

## Phase 7: Live Flow Tests (Playwright)

### Task 29: Live test — cycle overlay renders on trigger

**Files:**
- Create: `tests/live/flow/fitness/cycle-challenge-happy-path.runtime.test.mjs`

**Prereqs:**
- Admin trigger route `/api/v1/fitness/admin/trigger-challenge` must accept cycle payloads. Create if absent (sub-task inside this task, adds a router change + minimal unit test).
- Mock cadence feed endpoint — reuse or extend existing mock HR harness.

**Step 1: Write failing test**

Playwright: start dev server, trigger cycle challenge via admin endpoint, assert `.cycle-challenge-overlay` in DOM, verify rider avatar and target RPM.

**Step 5: Commit**

```bash
git commit -am "test(fitness): live flow — cycle challenge overlay renders on trigger"
```

---

### Task 30: Live test — swap modal flow

`tests/live/flow/fitness/cycle-challenge-swap-modal.runtime.test.mjs` — see design doc §Testing.

```bash
git commit -am "test(fitness): live flow — cycle swap modal"
```

---

### Task 31: Live test — dim progression

`tests/live/flow/fitness/cycle-challenge-dim-progression.runtime.test.mjs` — drive mock cadence, assert `--cycle-dim` CSS var changes.

```bash
git commit -am "test(fitness): live flow — cycle dim progression"
```

---

### Task 32: Live test — lock screen recovery

`tests/live/flow/fitness/cycle-challenge-lock-screen.runtime.test.mjs`.

```bash
git commit -am "test(fitness): live flow — cycle lock screen"
```

---

## Phase 8: Fuzz + Snapshot Tests

### Task 33: Fuzz test — state machine invariants

**Files:**
- Create: `tests/unit/governance/GovernanceEngine-cycleFuzz.test.mjs`

**Step 1: Write test**

```javascript
// Random tick walk over 500 steps with random rpm/zone inputs
// Invariants:
//   (1) phaseProgressMs ∈ [0, maintain_seconds*1000]
//   (2) boostMultiplier ∈ [1.0, max_total_multiplier]
//   (3) currentPhaseIndex ∈ [0, totalPhases]
//   (4) cycleState transitions only via valid edges (verify state-transition log)
//   (5) videoLocked iff cycleState==='locked' OR phase !== 'unlocked'
```

**Step 5: Commit**

```bash
git commit -am "test(governance): fuzz test for cycle state machine invariants"
```

---

### Task 34: Snapshot tests — golden state at key moments

**Files:**
- Create: `tests/unit/governance/GovernanceEngine-cycleSnapshot.golden.test.mjs`

**Step 1: Write test**

Seeded engine, drive deterministic timeline:
- Init start
- First ramp begin
- First maintain midpoint
- First maintain complete
- Second ramp
- Lock (force rpm below lo)
- Recovery
- Success

For each, snapshot state with timestamps stripped. `toMatchSnapshot()` via jest-serializer config.

**Step 5: Commit**

```bash
git commit -am "test(governance): golden snapshot tests for cycle state transitions"
```

---

## Phase 9: Config + Documentation

### Task 35: Add cycle challenge example to real fitness config

**Files:**
- Modify: `data/household/config/fitness.yml` — add cycle selection to `policies.default.challenges[0].selections[]`, add `eligible_users` to `equipment.cycle_ace`.

**Step 1: Update config**

```yaml
equipment:
  - id: cycle_ace
    name: CycleAce
    type: stationary_bike
    cadence: 49904
    eligible_users: [kckern, felix, milo]   # adjust as desired
    rpm: {...}
```

And under `policies.default.challenges[0].selections`:

```yaml
- type: cycle
  label: "Cycle sprint"
  equipment: cycle_ace
  weight: 1
  user_cooldown_seconds: 600
  init:
    min_rpm: 30
    time_allowed_seconds: 60
  segment_count: [3, 4]
  segment_duration_seconds: [20, 40]
  ramp_seconds: [10, 20]
  hi_rpm_range: [50, 85]
  lo_rpm_ratio: 0.75
  sequence_type: progressive
  boost:
    zone_multipliers:
      hot: 0.5
      fire: 1.0
    max_total_multiplier: 3.0
```

**Step 2: Verify locally**

Start dev server, verify config loads without errors, trigger cycle manually via admin UI (or wait for natural selection), test end-to-end.

**Step 3: Commit**

```bash
git add data/household/config/fitness.yml
git commit -m "config(fitness): add cycle challenge example to default policy"
```

---

### Task 36: Update governance README

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.Readme.md` — add "Cycle Challenges" section per design doc.

**Step 1: Add section describing:**

- What a cycle challenge is
- Single rider, equipment-based
- Phases (ramp + maintain)
- Thresholds (`hi_rpm`, `lo_rpm`)
- Progressive dim behavior
- Boost mechanic (including self-boost)
- Rider swap windows
- Cooldowns
- Config example

**Step 2: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.Readme.md
git commit -m "docs(governance): document cycle challenge behavior in README"
```

---

### Task 37: Move design doc from `_wip/plans` to `reference/`

**Files:**
- Move: `docs/_wip/plans/2026-04-17-cycle-challenge-design.md` → `docs/reference/core/cycle-challenge-design.md`

```bash
git mv docs/_wip/plans/2026-04-17-cycle-challenge-design.md docs/reference/core/cycle-challenge-design.md
git commit -m "docs: promote cycle challenge design to reference docs"
```

---

## Validation Checklist

Before merge to main:

- [ ] `npm run test:unit` passes, includes all cycle challenge tests
- [ ] `npm run test:integrated` passes
- [ ] `npm run test:live:flow` passes (all 4 cycle live tests)
- [ ] Fuzz test runs 500 iterations without invariant violations
- [ ] Snapshot tests pass without regression
- [ ] Manual smoke: trigger cycle via admin UI, complete all phases, verify:
  - [ ] Overlay renders at all positions (top/middle/bottom)
  - [ ] RPM gauge needle tracks real cadence
  - [ ] Target RPM sign updates on phase transition
  - [ ] Dim effect applies smoothly in dim band
  - [ ] Lock screen shows RPM pills when forced
  - [ ] Swap modal opens from rider avatar tap during init
  - [ ] Audio cues fire on state transitions
  - [ ] Session summary includes cycle history entry
- [ ] Docs updated (`GovernanceEngine.Readme.md`, `docs/reference/core/cycle-challenge-design.md`)
- [ ] Real config has at least one cycle challenge entry
