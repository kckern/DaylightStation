import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});

import { GovernanceEngine } from './GovernanceEngine.js';

/**
 * Stepping counts.
 *
 * A zone is a heart-rate band, and a heart-rate band is a proxy for "is this
 * person working" that fails hardest on the youngest riders — the ones wearing
 * the least reliable straps and standing on the mat. Live mat activity answers
 * the same question directly, so it satisfies a zone requirement without
 * inventing a heart-rate zone for someone who has no pulse reading.
 */

/** `_getZoneRank` reads this off `_latestInputs`, so it rides along in inputs. */
const ZONE_RANKS = { rest: 0, cool: 1, active: 2 };

function engineWith({ activitySatisfiesZone = true } = {}) {
  const engine = new GovernanceEngine();
  engine._activePolicy = { activitySatisfiesZone };
  return engine;
}

/** A mat snapshot in the shape PressureMatActivityTracker actually emits. */
const mat = ({ online = true, active = true } = {}) => ({
  step_mat: { equipmentId: 'step_mat', online, active, sessionSteps: 40, stepsPerMinute: 30 },
});

function evaluateWith(engine, { inputs, zoneOf }) {
  engine._captureLatestInputs({ ...inputs, zoneRankMap: ZONE_RANKS });
  return engine._evaluateZoneRequirement(
    'active', 'all', inputs.activeParticipants, zoneOf, ZONE_RANKS, {}, inputs.activeParticipants.length,
  );
}

describe('mat activity as zone credit', () => {
  it('credits a stepping rider whose heart rate never reaches the zone', () => {
    const engine = engineWith();
    const summary = evaluateWith(engine, {
      inputs: {
        activeParticipants: ['stepper'],
        activityMetricMap: mat(),
        equipmentRiderMap: { step_mat: 'stepper' },
      },
      zoneOf: { stepper: 'rest' },
    });

    expect(summary.satisfied).toBe(true);
    expect(summary.metUsers).toContain('stepper');
  });

  it('does NOT credit a mat that is reporting but has seen no recent step', () => {
    const engine = engineWith();
    const summary = evaluateWith(engine, {
      inputs: {
        activeParticipants: ['stepper'],
        activityMetricMap: mat({ active: false }),
        equipmentRiderMap: { step_mat: 'stepper' },
      },
      zoneOf: { stepper: 'rest' },
    });

    // 200 steps an hour ago is not evidence about this moment.
    expect(summary.satisfied).toBe(false);
  });

  it('does NOT credit an offline mat', () => {
    const engine = engineWith();
    const summary = evaluateWith(engine, {
      inputs: {
        activeParticipants: ['stepper'],
        activityMetricMap: mat({ online: false }),
        equipmentRiderMap: { step_mat: 'stepper' },
      },
      zoneOf: { stepper: 'rest' },
    });
    expect(summary.satisfied).toBe(false);
  });

  it('credits nobody when the mat is unclaimed — activity belongs to a person', () => {
    const engine = engineWith();
    const summary = evaluateWith(engine, {
      inputs: {
        activeParticipants: ['stepper'],
        activityMetricMap: mat(),
        equipmentRiderMap: {},
      },
      zoneOf: { stepper: 'rest' },
    });
    expect(summary.satisfied).toBe(false);
  });

  it('can be switched off per policy', () => {
    const engine = engineWith({ activitySatisfiesZone: false });
    const summary = evaluateWith(engine, {
      inputs: {
        activeParticipants: ['stepper'],
        activityMetricMap: mat(),
        equipmentRiderMap: { step_mat: 'stepper' },
      },
      zoneOf: { stepper: 'rest' },
    });
    expect(summary.satisfied).toBe(false);
  });

  it('leaves a rider who is genuinely in the zone exactly as it found them', () => {
    const engine = engineWith();
    const summary = evaluateWith(engine, {
      inputs: {
        activeParticipants: ['rider'],
        activityMetricMap: {},
        equipmentRiderMap: {},
      },
      zoneOf: { rider: 'active' },
    });
    expect(summary.satisfied).toBe(true);
    expect(summary.metUsers).toContain('rider');
  });
});

describe('inert requirement reporting', () => {
  it('names a rule that has never once been able to apply', () => {
    const engine = new GovernanceEngine();
    const definition = { id: 'tricycle_idle', type: 'cadence_floor', equipment: 'tricycle' };
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    // Seeded past the grace window: this rule has been configured and useless
    // for a minute, which is the state that has to become visible.
    engine._requirementLiveness = new Map([
      ['tricycle_idle', { firstSeenAt: now - 61_000, everActive: false, reported: false }],
    ]);

    engine._noteRequirementInert(definition);
    // Reported at most once — a broken rule is one line, not a per-tick stream.
    engine._noteRequirementInert(definition);
    expect(engine._requirementLiveness.get('tricycle_idle').reported).toBe(true);
    Date.now.mockRestore();
  });

  it('never calls a rule inert once it has produced a summary', () => {
    const engine = new GovernanceEngine();
    const definition = { id: 'tricycle_idle', type: 'cadence_floor' };
    engine._noteRequirementActive(definition);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 600_000);
    engine._noteRequirementInert(definition);
    expect(engine._requirementLiveness.get('tricycle_idle').reported).toBe(false);
    Date.now.mockRestore();
  });

  it('holds its tongue during the grace window', () => {
    const engine = new GovernanceEngine();
    engine._noteRequirementInert({ id: 'fresh', type: 'cadence_floor' });
    expect(engine._requirementLiveness.get('fresh').reported).toBe(false);
  });
});
