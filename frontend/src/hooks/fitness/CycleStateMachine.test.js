// frontend/src/hooks/fitness/CycleStateMachine.test.js
//
// Task 5 — sensor-blip integration tests for the cycle state machine.
//
// These tests reproduce the 2026-05-04 pattern where the equipment cadence
// stream bounced 0↔55 every ~200 ms (single-sample dropouts on a real ANT+
// link) and prove that the CadenceFilter (Tasks 1-3) plus its wiring into
// GovernanceEngine (Task 4) plus Task 6's transition debounce prevent lock
// storms while still locking on real abandonment.
//
// Block A: noise resilience + implausible-spike rejection.
// Block B: 5-second freshness contract end-to-end.

import { describe, it, expect } from 'vitest';
import { GovernanceEngine } from './GovernanceEngine.js';

// Lightweight LCG so tests are reproducible across runs and machines.
function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

// Minimal session shape used by GovernanceEngine. Mirrors the fixture in
// tests/unit/governance/GovernanceEngine-cycleDispatch.test.mjs so behaviour
// stays consistent with the existing dispatch test.
function buildSession() {
  return {
    _deviceRouter: {
      getEquipmentCatalog: () => [{ id: 'cycle_ace', eligible_users: ['felix'] }]
    },
    getParticipantProfile: () => null,
    zoneProfileStore: null,
    getActiveParticipantState: () => ({
      participants: ['felix'],
      zoneMap: { felix: 'active' },
      totalCount: 1
    })
  };
}

const POLICY = {
  governed_labels: ['cardio'],
  grace_period_seconds: 30,
  policies: {
    default: {
      name: 'Default',
      base_requirement: [{ active: 'all' }],
      challenges: [{
        interval: [1, 1],
        selections: [{
          type: 'cycle',
          equipment: 'cycle_ace',
          hi_rpm_range: [60, 60],
          segment_count: [1, 1],
          segment_duration_seconds: [2, 2],
          ramp_seconds: [5, 5],
          init: { min_rpm: 30, time_allowed_seconds: 10 },
          // lo_rpm = 60 * 0.5 = 30
          lo_rpm_ratio: 0.5,
          time_allowed: 999
        }]
      }]
    }
  }
};

// Selection ID is built from `${policyId}_${challengeIdx}_${selectionIdx}`
// in GovernanceEngine._normalizePolicies. Our single-policy/single-challenge
// /single-selection fixture resolves to default_0_0.
const CYCLE_SELECTION_ID = 'default_0_0';

// tick() pumps a single evaluate() call with a freshly-stamped cadence sample.
// nowValue must be advanced by the caller; the function does not mutate the
// closure clock.
function tick(engine, nowValue, { zone = 'active', rpm = 0, connected = true } = {}) {
  return engine.evaluate({
    activeParticipants: ['felix'],
    userZoneMap: { felix: zone },
    zoneRankMap: { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 },
    zoneInfoMap: {
      active: { id: 'active', name: 'Active' },
      warm: { id: 'warm', name: 'Warm' }
    },
    totalCount: 1,
    // ts mirrors the engine clock so the freshness gate in
    // _filteredCadenceFor sees each tick as a new sample.
    equipmentCadenceMap: { cycle_ace: { rpm, connected, ts: nowValue } }
  });
}

// Helper to spin up a fully-configured engine with a manually-triggered
// cycle challenge ready to receive cadence ticks. Returns { engine, getNow,
// setNow } so the caller can advance the clock between ticks.
function makeEngineWithActiveCycle(seed = 42) {
  let nowValue = 100000;
  const session = buildSession();
  const engine = new GovernanceEngine(session, {
    now: () => nowValue,
    random: seededRng(seed)
  });
  engine.configure(POLICY);
  engine.setMedia({ id: 'v1', type: 'episode', labels: ['cardio'] });
  // Manual trigger sets manualTrigger=true on the active challenge, which
  // makes the cycle SM advance via tickManualCycle() regardless of the
  // surrounding governance phase. It also bypasses the per-user cooldown
  // and forces 'felix' as the rider.
  const result = engine.triggerChallenge({
    type: 'cycle',
    selectionId: CYCLE_SELECTION_ID,
    riderId: 'felix'
  });
  if (!result || result.success !== true) {
    throw new Error(
      `triggerChallenge failed: ${result?.reason || 'unknown'} — fixture is broken`
    );
  }
  return {
    engine,
    getNow: () => nowValue,
    setNow: (v) => { nowValue = v; },
    advance: (delta) => { nowValue += delta; return nowValue; }
  };
}

// Drive a full cadence sequence through a fresh engine and capture the
// PUBLISHED (snapshot) cycleState after each evaluate(). Used by Task 6's
// debounce tests + Task 5's noise-resilience test. The published state is
// what the overlay reads — the internal `activeChallenge.cycleState` may
// disagree during the 500 ms hold-down window.
//
// `samples` is an array of { rpm, ts }. `ts` becomes the engine clock at
// the moment of evaluate() and the cadence sample's timestamp.
function runCadenceSequence(samples, seed = 42) {
  const fixture = makeEngineWithActiveCycle(seed);
  const states = [];
  for (const sample of samples) {
    fixture.setNow(sample.ts);
    fixture.engine.evaluate({
      activeParticipants: ['felix'],
      userZoneMap: { felix: 'warm' },
      zoneRankMap: { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 },
      zoneInfoMap: {
        active: { id: 'active', name: 'Active' },
        warm: { id: 'warm', name: 'Warm' }
      },
      totalCount: 1,
      equipmentCadenceMap: { cycle_ace: { rpm: sample.rpm, connected: true, ts: sample.ts } }
    });
    // Reading engine.state forces _composeState → _buildChallengeSnapshot,
    // which is where the published-state debounce runs. Without this read,
    // the snapshot is never built and the debounce never updates.
    const state = fixture.engine.state;
    states.push(state?.challenge?.cycleState ?? null);
  }
  return states;
}

describe('Cycle SM — sensor noise resilience', () => {
  it('does not enter locked when rpm bounces 0↔55 (single-sample dropouts)', () => {
    const samples = [];
    let ts = 1000;
    // Pre-prime: 5 ticks at sustained 80 RPM gets us through init→ramp→maintain.
    for (let i = 0; i < 5; i += 1) { samples.push({ rpm: 80, ts }); ts += 200; }
    // Then 30 alternating samples — the production noise pattern.
    for (let i = 0; i < 30; i += 1) {
      samples.push({ rpm: i % 2 === 0 ? 55 : 0, ts });
      ts += 200;
    }
    const states = runCadenceSequence(samples, 42);

    // Count published-state TRANSITIONS into locked (not ticks-while-locked).
    // EMA of alternating 0↔55 settles ~21-34 RPM, below loRpm — so a sustained
    // lock is correct behaviour. The user's bug was flicker (many transitions);
    // the debounce ensures at most one transition.
    let lockTransitions = 0;
    let prev = null;
    for (const s of states) {
      if (s === 'locked' && prev !== 'locked') lockTransitions += 1;
      prev = s;
    }
    expect(lockTransitions).toBeLessThanOrEqual(1);
  });

  it('does still lock when rpm is sustained below loRpm past the health pool depletion (~3s)', () => {
    const { engine, advance } = makeEngineWithActiveCycle(7);
    // Drive into maintain: hi_rpm=60, so feed rpm=80 a few times. EMA passes
    // the first sample through unsmoothed so we hit 80 immediately.
    for (let i = 0; i < 5; i += 1) {
      advance(200);
      tick(engine, engine._now(), { zone: 'warm', rpm: 80 });
    }
    expect(engine.challengeState.activeChallenge.cycleState).toBe('maintain');

    // Now sustain rpm=10, well below loRpm=30. The health meter depletes at
    // 1ms/ms below lo, so 3s of below-lo input empties the 3000ms pool.
    // 25 ticks × 200 ms = 5 s comfortably clears the pool plus EMA settle time.
    const states = [];
    for (let i = 0; i < 25; i += 1) {
      advance(200);
      tick(engine, engine._now(), { zone: 'warm', rpm: 10 });
      states.push(engine.challengeState?.activeChallenge?.cycleState ?? null);
    }
    expect(states).toContain('locked');
  });

  it('does not propagate an 11618-RPM implausible spike to currentRpm', () => {
    const { engine, advance } = makeEngineWithActiveCycle(13);
    // Seed a baseline EMA around 60 so the spike has a believable predecessor.
    advance(200);
    tick(engine, engine._now(), { zone: 'warm', rpm: 60 });
    advance(200);
    tick(engine, engine._now(), { zone: 'warm', rpm: 60 });

    // Inject the implausible 11618 (this was the actual value seen in the
    // 2026-05-04 logs). CadenceFilter clamps anything > 200 to 0 *with*
    // implausible=true; the EMA then absorbs that as a 0-blip.
    advance(200);
    tick(engine, engine._now(), { zone: 'warm', rpm: 11618 });

    // Recover with a real reading.
    advance(200);
    tick(engine, engine._now(), { zone: 'warm', rpm: 60 });

    const active = engine.challengeState.activeChallenge;
    // currentRpm reflects the filtered value last propagated to the active
    // challenge by tickManualCycle. The clamp+EMA pipeline must keep it
    // bounded to a plausible range — anything < 120 confirms 11618 didn't
    // propagate.
    expect(active.currentRpm).toBeLessThan(120);
  });
});

describe('Cycle SM — cadence freshness', () => {
  it('lets the filter decay to 0 within 5s when the sensor stops broadcasting', () => {
    const { engine, setNow, advance } = makeEngineWithActiveCycle(99);

    // One fresh sample at t=1000 with rpm=80. We override nowValue first so
    // the engine clock and the cadence ts agree.
    setNow(1000);
    engine.evaluate({
      activeParticipants: ['felix'],
      userZoneMap: { felix: 'warm' },
      zoneRankMap: { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 },
      zoneInfoMap: { warm: { id: 'warm', name: 'Warm' } },
      totalCount: 1,
      equipmentCadenceMap: { cycle_ace: { rpm: 80, connected: true, ts: 1000 } }
    });

    // Now tick the engine clock forward, but pass the SAME cadence entry
    // (ts stays at 1000). The freshness gate in _filteredCadenceFor sees
    // entryTs <= lastSeen and routes to filter.tick(now), which advances
    // the staleness clock. We stop at t=6500 — 5.5 s past the last fresh
    // sample, comfortably past the 5 s hard contract.
    const staleEntry = { rpm: 80, connected: true, ts: 1000 };
    while (engine._now() < 6500) {
      advance(200);
      engine.evaluate({
        activeParticipants: ['felix'],
        userZoneMap: { felix: 'warm' },
        zoneRankMap: { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 },
        zoneInfoMap: { warm: { id: 'warm', name: 'Warm' } },
        totalCount: 1,
        equipmentCadenceMap: { cycle_ace: staleEntry }
      });
    }

    // currentRpm is set inside tickManualCycle from the filtered output.
    // After 5.5 s with no fresh samples, the filter must have decayed to 0.
    expect(engine.challengeState.activeChallenge.currentRpm).toBe(0);
  });
});

describe('Cycle SM — transition debounce', () => {
  // Task 6: the *internal* cycleState may flip to locked the moment the
  // EMA crosses below loRpm, but the *published* snapshot (what the overlay
  // reads) holds the previous state until the new one has been stable for
  // ≥500 ms. These tests observe the published state via `engine.state`.

  it('does not surface a locked snapshot when locked-state lasts <500 ms', () => {
    // Pre-prime to maintain with sustained 80 RPM, then inject a brief dip.
    // The EMA absorbs single-sample dropouts (one 0 against ema=80 → 48 →
    // back to 60.8 on recovery), so the internal SM never enters locked.
    // The published snapshot must therefore never show locked either.
    const samples = [];
    let ts = 1000;
    for (let i = 0; i < 5; i += 1) { samples.push({ rpm: 80, ts }); ts += 200; } // → maintain
    samples.push({ rpm: 0,  ts }); ts += 200;   // brief dump (1 sample = ~200ms)
    samples.push({ rpm: 80, ts });              // recover before 500ms hold expires
    const states = runCadenceSequence(samples);
    expect(states[states.length - 1]).not.toBe('locked');
  });

  it('does surface a locked snapshot when locked-state lasts ≥500 ms (and the health pool has emptied)', () => {
    // Pre-prime to maintain, then sustain rpm=0 long enough for the EMA to
    // decay below loRpm, the health pool (~3s) to deplete to zero, AND the
    // published-state debounce (≥500 ms) to release the locked snapshot.
    // Sustained-zero ticks for 4 s + a final tail sample easily clears both.
    const samples = [];
    let ts = 1000;
    for (let i = 0; i < 5; i += 1) { samples.push({ rpm: 80, ts }); ts += 200; } // → maintain
    // 20 below-lo ticks × 250 ms = 5 s of below-lo input.
    for (let i = 0; i < 20; i += 1) { samples.push({ rpm: 0, ts }); ts += 250; }
    // One trailing tick so the published-state debounce has ≥500 ms past the
    // internal lock to release.
    samples.push({ rpm: 0, ts });
    const states = runCadenceSequence(samples);
    expect(states[states.length - 1]).toBe('locked');
  });
});

describe('Cycle SM — init↔ramp gate symmetry (Task 7)', () => {
  // Audit finding F2: in production, when a rider was pedalling at >= minRpm
  // BUT their HR didn't satisfy the per-rider base-requirement gate, the
  // init→ramp transition was blocked. After the 10 s init clock expired, the
  // engine locked. Recovery from `locked` (lockReason='init') only required
  // rpm >= minRpm — NOT the baseReq — so the engine bounced back to init the
  // very next tick, the init clock reset, and the cycle repeated every 10 s.
  //
  // Fix (Task 7): when init times out and the rider IS pedalling but baseReq
  // is unmet, hold in init (reset the init clock to 0) and surface a
  // `waitingForBaseReq: true` flag. Lock only on TRUE abandonment — when
  // both rpm < minRpm AND baseReq is unmet.
  //
  // These tests bypass `engine.evaluate()` and call `_evaluateCycleChallenge`
  // directly — the same approach as the existing jest cycleInit tests
  // (tests/unit/governance/GovernanceEngine-cycleInit.test.mjs). The full
  // evaluate() path requires `phase === 'unlocked'` for non-manual cycles,
  // which is impossible to arrange with a rider whose own zone fails the
  // base requirement (single-participant fixture). Direct invocation keeps
  // the test focused on the gate-symmetry behaviour without dragging in the
  // surrounding policy/phase machinery.

  // Helper: spin up a fresh engine + active cycle challenge with manualTrigger
  // explicitly false, so the (baseReqSatisfiedForRider || manualTrigger) gate
  // in _evaluateCycleChallenge actually depends on baseReqSatisfiedForRider.
  function makeNonManualCycle(seed = 42) {
    let nowValue = 100000;
    const session = buildSession();
    const engine = new GovernanceEngine(session, {
      now: () => nowValue,
      random: seededRng(seed)
    });
    engine.configure(POLICY);
    engine.setMedia({ id: 'v1', type: 'episode', labels: ['cardio'] });
    // Trigger WITHOUT riderId so manualTrigger is false on the active challenge.
    const result = engine.triggerChallenge({ type: 'cycle', selectionId: CYCLE_SELECTION_ID });
    if (!result || result.success !== true) {
      throw new Error(`triggerChallenge failed: ${result?.reason || 'unknown'}`);
    }
    const active = engine.challengeState.activeChallenge;
    if (!active || active.manualTrigger !== false) {
      throw new Error('Fixture broken: expected manualTrigger=false on active challenge');
    }
    // Initialise _lastCycleTs so the first dt is computed against a known stamp.
    active._lastCycleTs = nowValue;
    return {
      engine,
      active,
      getNow: () => nowValue,
      setNow: (v) => { nowValue = v; },
      advance: (delta) => { nowValue += delta; return nowValue; }
    };
  }

  it('does not enter locked on init_timeout when rider is pedalling but baseReq is unmet', () => {
    const { engine, active, advance, getNow } = makeNonManualCycle(42);
    // Init timeout in fixture is 10 s. We tick 360 × 200 ms = 72 s. Without
    // the fix this oscillates init→locked→init repeatedly; with the fix the
    // engine holds in init and surfaces waitingForBaseReq=true.
    const states = [];
    for (let i = 0; i < 360; i += 1) {
      advance(200);
      engine._evaluateCycleChallenge(active, {
        equipmentRpm: 60,                  // above minRpm=30
        baseReqSatisfiedForRider: false,   // HR-zone gate unmet
        baseReqSatisfiedGlobal: true,      // global gate met (avoids pause)
        activeParticipants: ['felix'],
        userZoneMap: { felix: 'cool' }
      });
      states.push(active.cycleState);
    }
    const lockEvents = states.filter((s) => s === 'locked').length;
    expect(lockEvents).toBe(0);
    expect(active.waitingForBaseReq).toBe(true);
  });

  it('does enter locked on init_timeout when rider is below minRpm AND baseReq is unmet', () => {
    const { engine, active, advance } = makeNonManualCycle(42);
    // True abandonment: rider not pedalling AND base-req not met. After the
    // 10 s init clock expires, the engine MUST lock — only the gate-symmetry
    // case (rpm met, baseReq unmet) is special-cased.
    for (let i = 0; i < 360; i += 1) {
      advance(200);
      engine._evaluateCycleChallenge(active, {
        equipmentRpm: 5,                   // well below minRpm=30
        baseReqSatisfiedForRider: false,
        baseReqSatisfiedGlobal: true,
        activeParticipants: ['felix'],
        userZoneMap: { felix: 'cool' }
      });
      if (active.cycleState === 'locked') break;
    }
    expect(active.cycleState).toBe('locked');
    expect(active.lockReason).toBe('init');
  });
});

describe('Cycle SM — init/ramp clocks pause when rider is idle (Task 8)', () => {
  it('marks the clock as paused when rpm is below minRpm', () => {
    const { engine, advance } = makeEngineWithActiveCycle(42);

    // Advance time and feed a single tick at rpm=5 (below minRpm=30).
    // The snapshot should mark clockPaused=true.
    advance(200);
    tick(engine, engine._now(), { zone: 'warm', rpm: 5 });

    const snap = engine.state?.challenge;
    expect(snap).toBeDefined();
    expect(snap.clockPaused).toBe(true);
  });

  it('marks the clock as active when rpm is at or above minRpm', () => {
    const { engine, advance } = makeEngineWithActiveCycle(42);

    // Advance time and feed a tick at rpm=60 (above minRpm=30).
    // The snapshot should mark clockPaused=false.
    advance(200);
    tick(engine, engine._now(), { zone: 'warm', rpm: 60 });

    const snap = engine.state?.challenge;
    expect(snap).toBeDefined();
    expect(snap.clockPaused).toBe(false);
  });
});

describe('Cycle SM — filter state reset', () => {
  // I-3 (audit closeout): GovernanceEngine's per-equipment _cadenceFilters and
  // _lastSeenCadenceTs Maps are populated lazily and never cleared. When a
  // cycle challenge ends and a new one starts on the same equipment, the new
  // challenge must NOT inherit the prior filter's EMA/watermark — otherwise
  // the first sample on the new challenge is smoothed against residual state
  // from the prior lock period.
  it('clears cadence filter state when a new cycle challenge starts', () => {
    const { engine, advance } = makeEngineWithActiveCycle(42);

    // Drag the EMA down with sustained low-RPM samples on the first challenge.
    for (let i = 0; i < 10; i += 1) {
      advance(200);
      tick(engine, engine._now(), { zone: 'warm', rpm: 5 });
    }
    // EMA should now be ≈5 (seeded at 5 on first sample, then steady).
    expect(engine.challengeState.activeChallenge.currentRpm).toBeLessThan(10);

    // End the prior challenge — there is no public "end" method; null it
    // directly, mirroring how the engine itself clears activeChallenge in
    // terminal paths (see e.g. lines 2762/2782 of GovernanceEngine.js).
    engine.challengeState.activeChallenge = null;

    // Start a new challenge on the same equipment.
    const result = engine.triggerChallenge({
      type: 'cycle',
      selectionId: CYCLE_SELECTION_ID,
      riderId: 'felix'
    });
    expect(result.success).toBe(true);

    // First cadence sample on the new challenge. If the filter state was
    // reset, this 80 RPM is passed through unsmoothed (ema=null on a fresh
    // filter). If not, the EMA carries over from the prior low value and the
    // smoothed result is much lower (0.4*80 + 0.6*5 ≈ 35).
    advance(200);
    tick(engine, engine._now(), { zone: 'warm', rpm: 80 });

    expect(engine.challengeState.activeChallenge.currentRpm).toBeGreaterThan(70);
  });
});

describe('Cycle SM — health meter direct eval (maintain branch)', () => {
  // The maintain branch depletes cycleHealthMs while RPM < loRpm and locks
  // (lockReason='health') when the pool empties. Recovery requires RPM >= hiRpm.
  // These tests drive _evaluateCycleChallenge directly (bypassing EMA/filter) to
  // give precise control over dt and equipmentRpm.

  function makeMaintainCycle(seed = 42) {
    let nowValue = 100000;
    const session = buildSession();
    const engine = new GovernanceEngine(session, {
      now: () => nowValue,
      random: seededRng(seed)
    });
    engine.configure(POLICY);
    engine.setMedia({ id: 'v1', type: 'episode', labels: ['cardio'] });
    const result = engine.triggerChallenge({
      type: 'cycle',
      selectionId: CYCLE_SELECTION_ID,
      riderId: 'felix'
    });
    if (!result || result.success !== true) {
      throw new Error(`triggerChallenge failed: ${result?.reason || 'unknown'}`);
    }
    const active = engine.challengeState.activeChallenge;
    // Pin to maintain directly — we're testing the maintain branch in isolation.
    active.cycleState = 'maintain';
    active._lastCycleTs = nowValue;
    return {
      engine,
      active,
      getNow: () => nowValue,
      setNow: (v) => { nowValue = v; },
      advance: (delta) => { nowValue += delta; return nowValue; }
    };
  }

  it('depletes health when rpm dips below loRpm in maintain', () => {
    const { engine, active, advance } = makeMaintainCycle(42);
    const phase = active.generatedPhases[0];
    const healthBefore = active.cycleHealthMs;
    advance(200);
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: phase.loRpm - 5, // below lo
      activeParticipants: ['felix'],
      userZoneMap: { felix: 'warm' },
      baseReqSatisfiedForRider: true,
      baseReqSatisfiedGlobal: true
    });
    // Health should have depleted but not yet locked (200ms < 3000ms pool).
    expect(active.cycleState).toBe('maintain');
    expect(active.cycleHealthMs).toBeLessThan(healthBefore);

    // Snapshot exposes cycleHealthPct.
    engine._latestInputs.equipmentCadenceMap = {
      cycle_ace: { rpm: phase.loRpm - 5, connected: true, ts: engine._now() }
    };
    engine._latestInputs.activeParticipants = ['felix'];
    engine._latestInputs.userZoneMap = { felix: 'warm' };
    const snap = engine.state?.challenge;
    expect(snap.cycleHealthPct).toBeLessThan(1);
    expect(snap.cycleHealthPct).toBeGreaterThan(0.9); // only ~200ms depleted from 3000ms
  });

  it('recovers health when rpm goes back into the green zone', () => {
    const { engine, active, advance } = makeMaintainCycle(7);
    const phase = active.generatedPhases[0];
    // Drain some health.
    for (let i = 0; i < 5; i += 1) {
      advance(200);
      engine._evaluateCycleChallenge(active, {
        equipmentRpm: phase.loRpm - 5,
        activeParticipants: ['felix'], userZoneMap: { felix: 'warm' },
        baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true
      });
    }
    const drained = active.cycleHealthMs;
    expect(drained).toBeLessThan(3000);

    // Pedal back into green — health regenerates.
    advance(200);
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: phase.hiRpm + 5,
      activeParticipants: ['felix'], userZoneMap: { felix: 'warm' },
      baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true
    });
    expect(active.cycleHealthMs).toBeGreaterThan(drained);
    expect(active.cycleState).toBe('maintain');
  });

  it('locks (lockReason=health) after the health pool is fully depleted', () => {
    const { engine, active, advance } = makeMaintainCycle(13);
    const phase = active.generatedPhases[0];
    // Sustain rpm < lo across multiple ticks for >3 seconds total.
    for (let i = 0; i < 25; i += 1) {
      advance(200); // 25 ticks × 200 ms = 5 s
      engine._evaluateCycleChallenge(active, {
        equipmentRpm: phase.loRpm - 5,
        activeParticipants: ['felix'], userZoneMap: { felix: 'warm' },
        baseReqSatisfiedForRider: true, baseReqSatisfiedGlobal: true
      });
      if (active.cycleState === 'locked') break;
    }
    expect(active.cycleState).toBe('locked');
    expect(active.lockReason).toBe('health');
  });
});

describe('Cycle SM — baseReqSatisfiedForRider snapshot exposure', () => {
  // Pin Critical #1: CycleChallengeOverlay reads
  // `challenge.baseReqSatisfiedForRider` to drive the green/red HR-zone
  // indicator. Before the fix, the value was computed inside the eval loop
  // and discarded — never copied onto the active challenge nor surfaced in
  // the snapshot. These tests prove the value computed during eval is
  // exposed via engine.state.challenge.baseReqSatisfiedForRider.
  //
  // We invoke `_evaluateCycleChallenge` directly (mirroring the gate-symmetry
  // tests above) because the manual-trigger evaluate() path hardcodes
  // baseReqSatisfiedForRider=true inside tickManualCycle. The non-manual
  // eval-loop path requires phase==='unlocked', which is impossible to
  // arrange with a single-rider fixture whose zone fails the base
  // requirement. Direct invocation keeps the test focused on the
  // eval→snapshot wiring without dragging in policy/phase machinery.

  it('exposes baseReqSatisfiedForRider=true on the snapshot when the rider is in zone', () => {
    const { engine, advance } = makeEngineWithActiveCycle(42);
    const active = engine.challengeState.activeChallenge;
    active._lastCycleTs = engine._now();

    advance(200);
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 80,
      activeParticipants: ['felix'],
      userZoneMap: { felix: 'warm' },
      baseReqSatisfiedForRider: true,    // in zone
      baseReqSatisfiedGlobal: true
    });

    // _latestInputs is consulted by _buildChallengeSnapshot for boost
    // contributors; populate enough to keep the snapshot path happy.
    engine._latestInputs.activeParticipants = ['felix'];
    engine._latestInputs.userZoneMap = { felix: 'warm' };
    engine._latestInputs.equipmentCadenceMap = {
      cycle_ace: { rpm: 80, connected: true, ts: engine._now() }
    };

    const snap = engine.state?.challenge;
    expect(snap).toBeDefined();
    expect(snap.baseReqSatisfiedForRider).toBe(true);
  });

  it('exposes baseReqSatisfiedForRider=false on the snapshot when the rider is out of zone', () => {
    const { engine, advance } = makeEngineWithActiveCycle(42);
    const active = engine.challengeState.activeChallenge;
    active._lastCycleTs = engine._now();

    advance(200);
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 80,
      activeParticipants: ['felix'],
      userZoneMap: { felix: 'cool' },
      baseReqSatisfiedForRider: false,   // out of zone
      baseReqSatisfiedGlobal: true
    });

    engine._latestInputs.activeParticipants = ['felix'];
    engine._latestInputs.userZoneMap = { felix: 'cool' };
    engine._latestInputs.equipmentCadenceMap = {
      cycle_ace: { rpm: 80, connected: true, ts: engine._now() }
    };

    const snap = engine.state?.challenge;
    expect(snap).toBeDefined();
    expect(snap.baseReqSatisfiedForRider).toBe(false);
  });
});

describe('Cycle SM — health meter (2026-05-28 redesign)', () => {
  function intoMaintain(engine, advance) {
    for (let i = 0; i < 5; i += 1) {
      advance(200);
      tick(engine, engine._now(), { zone: 'warm', rpm: 80 });
    }
    expect(engine.challengeState.activeChallenge.cycleState).toBe('maintain');
  }

  it('starts maintain at full health', () => {
    const { engine, advance } = makeEngineWithActiveCycle(21);
    intoMaintain(engine, advance);
    const a = engine.challengeState.activeChallenge;
    expect(a.cycleHealthMs).toBe(3000);
  });

  it('depletes health below loRpm and locks (lockReason health) at zero', () => {
    const { engine, advance } = makeEngineWithActiveCycle(22);
    intoMaintain(engine, advance);
    // Sustain rpm=1 (well below lo=30). EMA crosses lo within ~2 ticks; then
    // ~3s of depletion empties the 3000ms health pool. 25 × 200ms = 5s covers it.
    let locked = false;
    for (let i = 0; i < 25 && !locked; i += 1) {
      advance(200);
      tick(engine, engine._now(), { zone: 'warm', rpm: 1 });
      if (engine.challengeState.activeChallenge.cycleState === 'locked') locked = true;
    }
    expect(locked).toBe(true);
    expect(engine.challengeState.activeChallenge.lockReason).toBe('health');
    expect(engine.challengeState.activeChallenge.cycleHealthMs).toBe(0);
  });

  it('regenerates health when back in the green zone (>= hiRpm)', () => {
    const { engine, advance } = makeEngineWithActiveCycle(23);
    intoMaintain(engine, advance);
    // Drain partway below lo.
    for (let i = 0; i < 5; i += 1) { advance(200); tick(engine, engine._now(), { zone: 'warm', rpm: 1 }); }
    const drained = engine.challengeState.activeChallenge.cycleHealthMs;
    expect(drained).toBeLessThan(3000);
    // Back to green for a while.
    for (let i = 0; i < 5; i += 1) { advance(200); tick(engine, engine._now(), { zone: 'warm', rpm: 80 }); }
    expect(engine.challengeState.activeChallenge.cycleHealthMs).toBeGreaterThan(drained);
  });

  it('recovers from a health lock and resets health when RPM returns to green', () => {
    const { engine, advance } = makeEngineWithActiveCycle(24);
    intoMaintain(engine, advance);
    for (let i = 0; i < 25; i += 1) { advance(200); tick(engine, engine._now(), { zone: 'warm', rpm: 1 }); }
    expect(engine.challengeState.activeChallenge.cycleState).toBe('locked');
    // Pedal back into green.
    for (let i = 0; i < 3; i += 1) { advance(200); tick(engine, engine._now(), { zone: 'warm', rpm: 90 }); }
    const a = engine.challengeState.activeChallenge;
    expect(a.cycleState).toBe('maintain');
    expect(a.cycleHealthMs).toBe(3000);
  });

  it('exposes cycleHealthPct in the snapshot and pauses video on health lock', () => {
    const { engine, advance } = makeEngineWithActiveCycle(25);
    function intoMaintainLocal() {
      for (let i = 0; i < 5; i += 1) { advance(200); tick(engine, engine._now(), { zone: 'warm', rpm: 80 }); }
    }
    intoMaintainLocal();
    // Full health → pct 1, video not locked.
    let snap = engine.state.challenge;
    expect(snap.cycleHealthPct).toBeCloseTo(1, 1);
    expect(engine.state.videoLocked).toBe(false);

    // Drain to a health lock.
    for (let i = 0; i < 25; i += 1) { advance(200); tick(engine, engine._now(), { zone: 'warm', rpm: 1 }); }
    snap = engine.state.challenge;
    expect(snap.cycleHealthPct).toBe(0);
    // Cycle health lock pauses the video even though governance phase is unlocked.
    expect(engine.state.videoLocked).toBe(true);
  });
});

describe('Cycle SM — standing rider claim', () => {
  function makeEngine(seed = 42, equipmentRiderMap = {}) {
    let nowValue = 100000;
    const session = buildSession();
    const engine = new GovernanceEngine(session, { now: () => nowValue, random: seededRng(seed) });
    engine.configure(POLICY);
    engine.setMedia({ id: 'v1', type: 'episode', labels: ['cardio'] });
    engine._latestInputs.equipmentRiderMap = equipmentRiderMap;
    return engine;
  }

  const SELECTION = { id: CYCLE_SELECTION_ID, equipment: 'cycle_ace', init: {}, hiRpmRange: [60, 60], segmentCount: [1, 1], segmentDurationSeconds: [2, 2], rampSeconds: [5, 5], loRpmRatio: 0.5 };

  it('uses the standing claim as the rider when one is set', () => {
    const engine = makeEngine(42, { cycle_ace: 'felix' });
    const active = engine._startCycleChallenge({ ...SELECTION }, {});
    expect(active.ok).not.toBe(false);
    expect(active.rider).toBe('felix');
  });

  it('grants eligibility to a claimed rider not in eligible_users', () => {
    const engine = makeEngine(42, { cycle_ace: 'kckern' });
    expect(engine._getEligibleUsers('cycle_ace')).toContain('kckern');
    const active = engine._startCycleChallenge({ ...SELECTION }, {});
    expect(active.rider).toBe('kckern');
  });

  it('falls back to random-from-eligible when no claim is set', () => {
    const engine = makeEngine(42, {});
    const active = engine._startCycleChallenge({ ...SELECTION }, {});
    expect(active.rider).toBe('felix');
  });

  it('forceRiderId takes precedence over a standing claim', () => {
    const engine = makeEngine(42, { cycle_ace: 'milo' });
    const active = engine._startCycleChallenge({ ...SELECTION }, { forceRiderId: 'felix' });
    expect(active.rider).toBe('felix');
  });
});

describe('Cycle SM — live rider swap on claim change', () => {
  it('force-swaps the active rider when the claim changes during the swap window', () => {
    let nowValue = 100000;
    const session = buildSession();
    const engine = new GovernanceEngine(session, { now: () => nowValue, random: seededRng(42) });
    engine.configure(POLICY);
    engine.setMedia({ id: 'v1', type: 'episode', labels: ['cardio'] });
    engine.triggerChallenge({ type: 'cycle', selectionId: CYCLE_SELECTION_ID, riderId: 'felix' });
    expect(engine.challengeState.activeChallenge.rider).toBe('felix');

    engine._latestInputs.equipmentRiderMap = { cycle_ace: 'milo' };
    nowValue += 200;
    engine.evaluate({
      activeParticipants: ['felix', 'milo'],
      userZoneMap: { felix: 'warm', milo: 'warm' },
      zoneRankMap: { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 },
      zoneInfoMap: { warm: { id: 'warm', name: 'Warm' } },
      totalCount: 2,
      equipmentCadenceMap: { cycle_ace: { rpm: 70, connected: true, ts: nowValue } },
      equipmentRiderMap: { cycle_ace: 'milo' }
    });

    expect(engine.challengeState.activeChallenge.rider).toBe('milo');
  });
});

describe('Cycle SM — tag-team swap mid-challenge (any non-terminal state)', () => {
  // A tired rider must be able to hand off mid-challenge — including while the
  // challenge is in maintain or health-locked. Previously the swap window was
  // gated to init / ramp@phase0, so a rider-change press during maintain/locked
  // was silently dropped (the 2026-06-01 session: milo's claim at 02:55:05 was
  // ignored because cycleState was 'maintain').
  const makeActiveCycle = (claim) => {
    let nowValue = 100000;
    const session = buildSession();
    const engine = new GovernanceEngine(session, { now: () => nowValue, random: seededRng(42) });
    engine.configure(POLICY);
    engine.setMedia({ id: 'v1', type: 'episode', labels: ['cardio'] });
    engine.triggerChallenge({ type: 'cycle', selectionId: CYCLE_SELECTION_ID, riderId: 'felix' });
    // Make the incoming rider eligible via a standing claim (mirrors a real press).
    engine._latestInputs.equipmentRiderMap = { cycle_ace: claim };
    return { engine, active: engine.challengeState.activeChallenge, advance: (ms) => { nowValue += ms; } };
  };

  it('honors a swap during the maintain phase', () => {
    const { engine, active } = makeActiveCycle('milo');
    active.cycleState = 'maintain';
    active.currentPhaseIndex = 1;
    const res = engine.swapCycleRider('milo', { force: true });
    expect(res.success).toBe(true);
    expect(active.rider).toBe('milo');
    // New rider re-warms up from init.
    expect(active.cycleState).toBe('init');
  });

  it('honors a swap while health-locked (fresh legs take over a tired rider)', () => {
    const { engine, active } = makeActiveCycle('milo');
    active.cycleState = 'locked';
    active.lockReason = 'health';
    const res = engine.swapCycleRider('milo', { force: true });
    expect(res.success).toBe(true);
    expect(active.rider).toBe('milo');
    expect(active.cycleState).toBe('init');
  });

  it('rejects a swap once the challenge is terminal (success)', () => {
    const { engine, active } = makeActiveCycle('milo');
    active.cycleState = 'success';
    const res = engine.swapCycleRider('milo', { force: true });
    expect(res.success).toBe(false);
    expect(active.rider).toBe('felix');
  });

  it('reassigns the rider when the claim changes during maintain (the 02:55 bug)', () => {
    let nowValue = 100000;
    const session = buildSession();
    const engine = new GovernanceEngine(session, { now: () => nowValue, random: seededRng(42) });
    engine.configure(POLICY);
    engine.setMedia({ id: 'v1', type: 'episode', labels: ['cardio'] });
    engine.triggerChallenge({ type: 'cycle', selectionId: CYCLE_SELECTION_ID, riderId: 'felix' });
    const active = engine.challengeState.activeChallenge;
    active.cycleState = 'maintain'; // phase 0 maintain — old gate only allowed ramp@phase0

    engine._latestInputs.equipmentRiderMap = { cycle_ace: 'milo' };
    nowValue += 200;
    engine.evaluate({
      activeParticipants: ['felix', 'milo'],
      userZoneMap: { felix: 'warm', milo: 'warm' },
      zoneRankMap: { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 },
      zoneInfoMap: { warm: { id: 'warm', name: 'Warm' } },
      totalCount: 2,
      equipmentCadenceMap: { cycle_ace: { rpm: 70, connected: true, ts: nowValue } },
      equipmentRiderMap: { cycle_ace: 'milo' }
    });

    expect(engine.challengeState.activeChallenge.rider).toBe('milo');
  });
});

describe('Cycle SM — video pause covers every lock reason (regression)', () => {
  // Bug (2026-06-04): state.videoLocked was special-cased to lockReason ===
  // 'health', so a ramp-timeout lock surfaced the lock overlay over a video
  // that kept playing. The single governance pause must fire for ANY cycle
  // lock; lockReason only steers the overlay UX, not whether the video pauses.
  it('sets state.videoLocked on a ramp-timeout lock, not just health', () => {
    const { engine, advance } = makeEngineWithActiveCycle(42);
    // Pedal at 45 RPM: above init.min_rpm (30) so we clear init into ramp, but
    // below hi_rpm (60) so the 5 s ramp window times out -> lockReason 'ramp'.
    let snap = null;
    for (let i = 0; i < 120; i += 1) {
      const now = advance(200);
      tick(engine, now, { zone: 'warm', rpm: 45 });
      snap = engine.state;
      // Wait for the PUBLISHED (debounced) snapshot to surface the lock.
      if (snap?.challenge?.cycleState === 'locked') break;
    }
    expect(snap?.challenge?.cycleState).toBe('locked');
    expect(snap?.challenge?.lockReason).toBe('ramp');
    expect(snap.videoLocked).toBe(true);
  });
});

describe('Cycle SM — locked cycle recovers from cadence despite unmet global base-req (rider-swap deadlock)', () => {
  it('recovers a locked cycle from cadence even when baseReqSatisfiedGlobal is false', () => {
    const { engine, getNow, advance } = makeEngineWithActiveCycle();
    const active = engine.challengeState.activeChallenge;

    // Reproduce the post-swap ramp-lock: a NON-manual challenge (manual
    // triggers bypass the pause gate), already locked, on phase 0.
    active.manualTrigger = false;
    active.cycleState = 'locked';
    active.lockReason = 'ramp';
    active.currentPhaseIndex = 0;
    active._pausedAt = null;
    active._lastCycleTs = getNow();

    // POLICY hi_rpm_range is [60,60] → phase.hiRpm === 60. Pedal well past it
    // while the global HR base-requirement is UNMET (the deadlock condition).
    advance(200);
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 90,
      activeParticipants: ['felix'],
      userZoneMap: { felix: 'cool' },
      baseReqSatisfiedForRider: false,
      baseReqSatisfiedGlobal: false
    });

    expect(active.cycleState).toBe('maintain');
    expect(active.lockReason).toBe(null);
  });

  it('still freezes a non-locked cycle (init/ramp/maintain) when global base-req is unmet', () => {
    const { engine, getNow, advance } = makeEngineWithActiveCycle();
    const active = engine.challengeState.activeChallenge;
    active.manualTrigger = false;
    active.cycleState = 'maintain';
    active.lockReason = null;
    active.currentPhaseIndex = 0;
    active._pausedAt = null;
    active._lastCycleTs = getNow();

    advance(200);
    engine._evaluateCycleChallenge(active, {
      equipmentRpm: 90,
      activeParticipants: ['felix'],
      userZoneMap: { felix: 'cool' },
      baseReqSatisfiedForRider: false,
      baseReqSatisfiedGlobal: false
    });

    // Pause gate still applies to non-locked states: frozen, _pausedAt stamped.
    expect(active.cycleState).toBe('maintain');
    expect(active._pausedAt).not.toBe(null);
  });
});

describe('Cycle SM — never-started failure timeout', () => {
  it('fails a challenge the rider never starts (stays at 0 rpm past the init grace)', () => {
    const { engine, advance } = makeEngineWithActiveCycle(11);
    const originalId = engine.challengeState.activeChallenge.id;

    // init.time_allowed_seconds = 10 → initTotalMs = 10000. Grace floor is
    // 15000ms, so failure fires ~10s (init) + 15s (init-lock) later. Drive
    // rpm=0 for 40s of 500ms ticks — the rider never reaches min_rpm (30).
    for (let i = 0; i < 80; i += 1) {
      advance(500);
      tick(engine, engine._now(), { zone: 'active', rpm: 0 });
      void engine.state; // build the snapshot each tick, mirroring the overlay
    }

    const failedEntry = engine.challengeState.challengeHistory.find(
      (h) => h.type === 'cycle' && h.status === 'failed'
    );
    expect(failedEntry).toBeTruthy();
    expect(failedEntry.failReason).toBe('never_started');
    expect(failedEntry.rider).toBe('felix');
    expect(failedEntry.phasesCompleted).toBe(0);

    // The original never-started challenge must be cleared (engine moved on),
    // not stuck in init-lock limbo. (felix is on cooldown after the fail, so no
    // replacement cycle can re-fire with him as the only eligible rider.)
    expect(engine.challengeState.activeChallenge?.id).not.toBe(originalId);
  });

  it('does NOT fail a rider who starts pedalling within the grace', () => {
    const { engine, advance } = makeEngineWithActiveCycle(12);
    // Sit idle 12s — into the init lock but well short of the 25s fail point...
    for (let i = 0; i < 24; i += 1) { advance(500); tick(engine, engine._now(), { rpm: 0 }); }
    // ...then pedal above min_rpm (30) and reach hi (60) — recovers into the workout.
    for (let i = 0; i < 16; i += 1) { advance(500); tick(engine, engine._now(), { zone: 'warm', rpm: 80 }); void engine.state; }

    // The rider recovered from the init lock and was NEVER failed...
    const failedEntry = engine.challengeState.challengeHistory.find(
      (h) => h.type === 'cycle' && h.status === 'failed'
    );
    expect(failedEntry).toBeUndefined();
    // ...and in fact completed the workout successfully (proving recovery, not a never-start fail).
    const successEntry = engine.challengeState.challengeHistory.find(
      (h) => h.type === 'cycle' && h.status === 'success'
    );
    expect(successEntry).toBeTruthy();
  });
});
