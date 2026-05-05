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

describe('Cycle SM — sensor noise resilience', () => {
  // TODO: re-enable after Task 6 transition debounce lands.
  //
  // The noise-resilience claim is that EMA(α=0.4) plus a transition debounce
  // together absorb the alternating-sample dropouts. EMA alone oscillates
  // around the midpoint (~25-37 RPM for 0↔55), which sits right on the
  // loRpm=30 boundary — so without the debounce the SM still flips between
  // maintain and locked. Skipping until Task 6 lands; do not "fix" this by
  // weakening assertions or tuning thresholds.
  it.skip('does not enter locked when rpm bounces 0↔55 (single-sample dropouts)', () => {
    const { engine, advance } = makeEngineWithActiveCycle(42);
    const states = [];
    for (let i = 0; i < 30; i += 1) {
      advance(200);
      tick(engine, engine._now(), {
        zone: 'warm',
        rpm: i % 2 === 0 ? 55 : 0
      });
      states.push(engine.challengeState?.activeChallenge?.cycleState ?? null);
    }
    const locks = states.filter((s) => s === 'locked').length;
    expect(locks).toBeLessThan(2);
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
