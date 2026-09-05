/**
 * `cadence_floor` — the steady-state "you were riding, now you're not" gate.
 *
 * The case it exists for: an EXEMPT rider (rider_a) on the tricycle. The zone
 * requirement can never blame him, and the cycle challenge only fires
 * episodically, so before this gate he could stop pedaling with no consequence.
 * These cover both halves — that it bites when there is real evidence of a
 * ride, and that it stays silent when there isn't.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});

import { GovernanceEngine } from './GovernanceEngine.js';

const config = {
  governed_labels: ['cardio'],
  grace_period_seconds: 30,
  exemptions: ['rider_a'],
  policies: {
    default: {
      requirements: [
        { type: 'zone', zone: 'active', rule: 'all' },
        {
          type: 'cadence_floor',
          id: 'trike_floor',
          equipment: 'tricycle',
          arm_seconds: 30,
          arm_min_rpm: 30,
          trip_after_seconds: 10,
        },
      ],
    },
  },
};

const REQ = (engine) => engine._normalizePolicies(config.policies)[0].requirements
  .find((r) => r.type === 'cadence_floor');

/** Drive the evaluator directly — the latch is time-based, not tick-based. */
const run = (engine, requirement, { rpm, connected = true, transportStalled = false, rider = 'rider_a', hrInactive = [], at }) =>
  engine._evaluateCadenceFloorRequirement(requirement, {
    equipmentCadenceMap: { tricycle: { rpm, connected, ...(transportStalled ? { transportStalled: true } : {}) } },
    equipmentRiderMap: rider ? { tricycle: rider } : {},
    activeParticipants: rider ? [rider] : [],
    hrInactiveUsers: hrInactive,
    timestamp: at,
  });

/** Pedal above the arm threshold for `ms`, in 1s steps, starting at t0. */
const pedal = (engine, requirement, t0, ms, opts = {}) => {
  let last = null;
  for (let t = t0; t <= t0 + ms; t += 1000) {
    last = run(engine, requirement, { rpm: 55, at: t, ...opts });
  }
  return last;
};

describe('GovernanceEngine — cadence_floor', () => {
  let engine;
  let requirement;

  beforeEach(() => {
    engine = new GovernanceEngine({ config });
    requirement = REQ(engine);
  });

  it('normalizes the requirement off the policy config', () => {
    expect(requirement).toMatchObject({
      type: 'cadence_floor', equipment: 'tricycle', armSeconds: 30, armMinRpm: 30,
      tripAfterSeconds: 10, requireRiderHr: true, enabled: true,
    });
  });

  it('rejects a requirement with no equipment or a non-positive threshold', () => {
    const bad = engine._normalizePolicies({
      p: { requirements: [
        { type: 'cadence_floor', equipment: '', arm_seconds: 30 },
        { type: 'cadence_floor', equipment: 'tricycle', arm_min_rpm: 0 },
      ] },
    })[0].requirements;
    expect(bad).toEqual([]);
  });

  it('stays dormant while the rider is still building evidence', () => {
    // 20s of pedaling — short of the 30s arm threshold.
    expect(pedal(engine, requirement, 0, 20_000)).toBeNull();
    // ...and stopping now must NOT trip: nothing was ever armed.
    expect(run(engine, requirement, { rpm: 0, connected: false, at: 60_000 })).toBeNull();
  });

  it('arms after sustained pedaling, then trips once RPM stays at zero', () => {
    expect(pedal(engine, requirement, 0, 31_000).satisfied).toBe(true);

    // The cadence device goes quiet within ~1.2s of stopping: connected:false
    // WITHOUT a transport stall is the stop signal, not a reason to stand down.
    expect(run(engine, requirement, { rpm: 0, connected: false, at: 33_000 }))
      .toMatchObject({ satisfied: true, missingUsers: [] });

    const tripped = run(engine, requirement, { rpm: 0, connected: false, at: 43_500 });
    expect(tripped.satisfied).toBe(false);
    // The whole point: an EXEMPT rider is blamed here and nowhere else.
    expect(tripped.missingUsers).toEqual(['rider_a']);
    expect(tripped.type).toBe('cadence_floor');
  });

  it('clears as soon as the rider starts pedaling again', () => {
    pedal(engine, requirement, 0, 31_000);
    // First zero sample only starts the clock; the trip needs the full window.
    run(engine, requirement, { rpm: 0, connected: false, at: 45_000 });
    expect(run(engine, requirement, { rpm: 0, connected: false, at: 56_000 }).satisfied).toBe(false);
    expect(run(engine, requirement, { rpm: 48, at: 57_000 }).satisfied).toBe(true);
  });

  it('never arms without a live heart-rate strap on the rider', () => {
    expect(pedal(engine, requirement, 0, 31_000, { hrInactive: ['rider_a'] })).toBeNull();
    expect(run(engine, requirement, { rpm: 0, connected: false, hrInactive: ['rider_a'], at: 60_000 })).toBeNull();
  });

  it('disarms when the strap drops after arming, so a dismount cannot lock the room', () => {
    pedal(engine, requirement, 0, 31_000);
    expect(run(engine, requirement, { rpm: 0, connected: false, hrInactive: ['rider_a'], at: 33_000 })).toBeNull();
    // Evidence is gone: stopping for well past the trip window trips nothing.
    expect(run(engine, requirement, { rpm: 0, connected: false, at: 90_000 })).toBeNull();
  });

  it('disarms when the equipment is unclaimed', () => {
    pedal(engine, requirement, 0, 31_000);
    expect(run(engine, requirement, { rpm: 0, connected: false, rider: null, at: 33_000 })).toBeNull();
  });

  it('starts the evidence over for a new rider', () => {
    pedal(engine, requirement, 0, 31_000);
    // Rider B takes over: rider A's 30s does not transfer.
    expect(run(engine, requirement, { rpm: 0, connected: false, rider: 'rider_b', at: 45_000 })).toBeNull();
  });

  it('suspends rather than trips while the whole transport is stalled', () => {
    pedal(engine, requirement, 0, 31_000);
    const stalled = run(engine, requirement, { rpm: 0, connected: false, transportStalled: true, at: 60_000 });
    // A starved pipeline says nothing about this rider.
    expect(stalled).toMatchObject({ suspended: true, satisfied: true, missingUsers: [] });
    // ...and it must not have been counting down toward a lock in the meantime.
    expect(run(engine, requirement, { rpm: 0, connected: false, at: 61_000 }).satisfied).toBe(true);
  });

  it('does not accrue arming evidence from a stalled transport', () => {
    for (let t = 0; t <= 60_000; t += 1000) {
      run(engine, requirement, { rpm: 55, connected: false, transportStalled: true, at: t });
    }
    expect(run(engine, requirement, { rpm: 0, connected: false, at: 61_000 })).toBeNull();
  });

  it('stays dormant when disabled', () => {
    const disabled = engine._normalizePolicies({
      p: { requirements: [{ type: 'cadence_floor', equipment: 'tricycle', enabled: false }] },
    })[0].requirements[0];
    expect(pedal(engine, disabled, 0, 60_000)).toBeNull();
  });
});
