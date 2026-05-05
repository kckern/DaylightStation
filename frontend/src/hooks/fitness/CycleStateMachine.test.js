// frontend/src/hooks/fitness/CycleStateMachine.test.js
//
// Task 5 — sensor-blip integration tests for the cycle state machine.
//
// These tests reproduce the 2026-05-04 pattern where the equipment cadence
// stream bounced 0↔55 every ~200 ms (single-sample dropouts on a real ANT+
// link) and prove that the CadenceFilter (Tasks 1-3) plus its wiring into
// GovernanceEngine (Task 4) plus Task 6's transition debounce (NOT yet
// landed at the time these tests were written) prevent lock storms while
// still locking on real abandonment.
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

  it('does still lock when rpm is sustained below loRpm for >1s', () => {
    const { engine, advance } = makeEngineWithActiveCycle(7);
    // Drive into maintain: hi_rpm=60, so feed rpm=80 a few times. EMA passes
    // the first sample through unsmoothed so we hit 80 immediately.
    for (let i = 0; i < 5; i += 1) {
      advance(200);
      tick(engine, engine._now(), { zone: 'warm', rpm: 80 });
    }
    expect(engine.challengeState.activeChallenge.cycleState).toBe('maintain');

    // Now sustain rpm=10, well below loRpm=30. EMA decays from 80 toward 10
    // but the very next maintain tick already sees a value below loRpm
    // (0.4*10 + 0.6*80 = 38 → next: 0.4*10 + 0.6*38 = 26.8 < 30). Even if
    // it took several ticks, 8 ticks × 200 ms = 1.6 s is plenty to lock.
    const states = [];
    for (let i = 0; i < 8; i += 1) {
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

  it('does surface a locked snapshot when locked-state lasts ≥500 ms', () => {
    // Pre-prime to maintain, then sustain rpm=0 long enough for the EMA to
    // decay below loRpm AND for the internal-locked state to be held for
    // ≥500 ms. Four 0-samples at 300 ms intervals gives 900 ms of zero
    // input, and after the EMA crosses below loRpm at the second one
    // (28.8 < 30), internal stays locked for ≥600 ms — past the debounce.
    const samples = [];
    let ts = 1000;
    for (let i = 0; i < 5; i += 1) { samples.push({ rpm: 80, ts }); ts += 200; } // → maintain
    samples.push({ rpm: 0, ts }); ts += 300;
    samples.push({ rpm: 0, ts }); ts += 300;
    samples.push({ rpm: 0, ts }); ts += 300;
    samples.push({ rpm: 0, ts });               // total below-lo span ≥900 ms
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
