/**
 * A pipeline stall must never lock a cycle rider. 2026-09-02: the backend
 * blocked 6-8 s at a time; the rider held 77-99 RPM the entire challenge
 * (sensor-side proof in the bug report) and was locked seven times at
 * currentRpm 0. The contrast case proves genuine silence still locks.
 *
 * See docs/_wip/bugs/2026-09-02-fitness-rpm-false-zeros-pause-video-during-cycle-challenge.md
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});

import { GovernanceEngine } from './GovernanceEngine.js';

function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function buildSession() {
  return {
    _deviceRouter: { getEquipmentCatalog: () => [{ id: 'cycle_ace', eligible_users: ['user_2'] }] },
    getParticipantProfile: () => null,
    zoneProfileStore: null,
    getActiveParticipantState: () => ({ participants: ['user_2'], zoneMap: { user_2: 'active' }, totalCount: 1 })
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
          type: 'cycle', equipment: 'cycle_ace',
          hi_rpm_range: [60, 60], segment_count: [1, 1], segment_duration_seconds: [6, 6],
          ramp_seconds: [5, 5], init: { min_rpm: 30, time_allowed_seconds: 10 },
          lo_rpm_ratio: 0.5, time_allowed: 999
        }]
      }]
    }
  }
};

function makeEngineWithActiveCycle({ governed = true } = {}) {
  let nowValue = 100000;
  const engine = new GovernanceEngine(buildSession(), { now: () => nowValue, random: seededRng(42) });
  engine.configure(POLICY);
  engine.setMedia({ id: 'v1', type: 'episode', labels: governed ? ['cardio'] : [] });
  const result = engine.triggerChallenge({ type: 'cycle', selectionId: 'default_0_0', riderId: 'user_2' });
  if (!result || result.success !== true) throw new Error(`triggerChallenge failed: ${result?.reason}`);
  return { engine, setNow: (v) => { nowValue = v; } };
}

function drive(fixture, samples) {
  for (const s of samples) {
    fixture.setNow(s.ts);
    fixture.engine.evaluate({
      activeParticipants: ['user_2'], userZoneMap: { user_2: 'warm' },
      zoneRankMap: { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 },
      zoneInfoMap: { active: { id: 'active', name: 'Active' }, warm: { id: 'warm', name: 'Warm' } },
      totalCount: 1,
      equipmentCadenceMap: { cycle_ace: s.entry }
    });
    void fixture.engine.state; // build the published snapshot, as the overlay would
  }
}

const fresh = (rpm, ts) => ({ rpm, connected: true, ts });
const STEP = 200;

function warmUp(startTs = 1000) {
  const samples = [];
  let ts = startTs;
  for (let i = 0; i < 8; i += 1) { samples.push({ ts, entry: fresh(80, ts) }); ts += STEP; }
  return { samples, ts };
}

describe('Cycle SM — pipeline stall vs genuine silence', () => {
  it('8 s in which NO device delivers never locks a rider who was in the green', () => {
    const f = makeEngineWithActiveCycle();
    const { samples, ts: afterWarm } = warmUp();
    drive(f, samples);
    expect(f.engine.challengeState.activeChallenge.cycleState).toBe('maintain');

    const lastFreshTs = afterWarm - STEP;
    // The gate must freeze the cycle clock, not merely avoid locking: a stall
    // says nothing about the rider, so it must buy no phase progress either.
    const progressBeforeStall = f.engine.challengeState.activeChallenge.phaseProgressMs;
    const stall = [];
    let ts = afterWarm;
    // The reader hands back the HELD value with connected:false, an unchanged
    // ts, and the stall flag. connected:false is deliberate — see the design
    // note; CycleGame must keep taking its bounded-hold branch.
    for (let i = 0; i < 40; i += 1) {
      stall.push({ ts, entry: { rpm: 80, connected: false, transportStalled: true, ts: lastFreshTs } });
      ts += STEP;
    }
    // Track what the overlay would show. The reported symptom in the bug was
    // `currentRpm: 0` on screen while the rider held 77-99 RPM; the filter must
    // HOLD its value through the stall, not decay it to a lost-signal 0.
    let minReportedRpm = Infinity;
    for (const s of stall) {
      drive(f, [s]);
      minReportedRpm = Math.min(minReportedRpm, f.engine.challengeState.activeChallenge.currentRpm);
    }
    const active = f.engine.challengeState.activeChallenge;
    expect(active.totalLockEventsCount).toBe(0);
    expect(active.cycleState).toBe('maintain');
    expect(minReportedRpm).toBe(80);
    expect(active.phaseProgressMs).toBe(progressBeforeStall);

    // Pipeline resumes; the rider is still at 80 and completes the segment.
    // A successful cycle is only published for CYCLE_SUCCESS_PUBLISH_MS before
    // it is cleared, so watch each tick rather than reading the end state.
    let reachedSuccess = false;
    let locksDuringResume = 0;
    for (let i = 0; i < 40 && !reachedSuccess; i += 1) {
      drive(f, [{ ts, entry: fresh(80, ts) }]);
      ts += STEP;
      const cur = f.engine.challengeState.activeChallenge;
      if (!cur) break;
      locksDuringResume = Math.max(locksDuringResume, cur.totalLockEventsCount || 0);
      if (cur.status === 'success') reachedSuccess = true;
    }
    expect(locksDuringResume).toBe(0);
    expect(reachedSuccess).toBe(true);
  });

  // The manual-cycle tick is a SECOND path into _evaluateCycleChallenge: when
  // the media is not governed, evaluate() early-returns and only tickManualCycle
  // advances the SM. It must carry the same stall gate — a demo/manual cycle can
  // starve exactly the same way.
  it('a manually-triggered cycle on ungoverned media also survives the stall', () => {
    const f = makeEngineWithActiveCycle({ governed: false });
    const { samples, ts: afterWarm } = warmUp();
    drive(f, samples);
    expect(f.engine.challengeState.activeChallenge.cycleState).toBe('maintain');

    const lastFreshTs = afterWarm - STEP;
    const progressBeforeStall = f.engine.challengeState.activeChallenge.phaseProgressMs;
    let ts = afterWarm;
    let minReportedRpm = Infinity;
    for (let i = 0; i < 40; i += 1) {
      drive(f, [{ ts, entry: { rpm: 80, connected: false, transportStalled: true, ts: lastFreshTs } }]);
      ts += STEP;
      minReportedRpm = Math.min(minReportedRpm, f.engine.challengeState.activeChallenge.currentRpm);
    }
    const active = f.engine.challengeState.activeChallenge;
    expect(active.totalLockEventsCount).toBe(0);
    expect(active.cycleState).toBe('maintain');
    expect(minReportedRpm).toBe(80);
    expect(active.phaseProgressMs).toBe(progressBeforeStall);
  });

  it('the same 8 s of genuine silence (pipeline alive, bike stopped) does lock', () => {
    const f = makeEngineWithActiveCycle();
    const { samples, ts: afterWarm } = warmUp();
    drive(f, samples);
    expect(f.engine.challengeState.activeChallenge.cycleState).toBe('maintain');

    const silence = [];
    let ts = afterWarm;
    for (let i = 0; i < 40; i += 1) { silence.push({ ts, entry: { rpm: 0, connected: false } }); ts += STEP; }
    drive(f, silence);
    expect(f.engine.challengeState.activeChallenge.totalLockEventsCount).toBeGreaterThan(0);
  });
});
