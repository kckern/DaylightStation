/**
 * The inert-requirement alarm is "at most one line per requirement per
 * SESSION". It used to survive reset(), so one warning per page load: on
 * 2026-10-20 it fired in the first session and stayed silent through a later
 * one where the tricycle cadence floor stood down for the whole workout.
 *
 * GovernanceEngine.reset() also runs MID-session (the no-policy branch of
 * evaluate), so the alarm memory is cleared at session end — from
 * FitnessSession.reset() via resetSessionAlarms() — not in engine.reset().
 */
import { describe, it, expect } from 'vitest';
import { GovernanceEngine } from "./GovernanceEngine.js";
import { FitnessSession } from "./FitnessSession.js";

const definition = { id: 'tricycle_idle', type: 'cadence_floor', equipment: 'tricycle' };

describe('GovernanceEngine — inert requirement alarm is per session', () => {
  it('a mid-session engine.reset() keeps the "already reported" memory', () => {
    const engine = new GovernanceEngine();
    engine._noteRequirementInert(definition);
    engine._requirementLiveness.get('tricycle_idle').reported = true;
    engine.reset();
    expect(engine._requirementLiveness?.get('tricycle_idle')?.reported).toBe(true);
  });

  it('resetSessionAlarms() forgets which requirements were already reported', () => {
    const engine = new GovernanceEngine();
    engine._noteRequirementInert(definition);
    engine._requirementLiveness.get('tricycle_idle').reported = true;
    engine.resetSessionAlarms();
    expect(engine._requirementLiveness?.get('tricycle_idle')).toBeUndefined();
  });

  it('a session ending (FitnessSession.reset) clears it', () => {
    const session = new FitnessSession();
    session.governanceEngine._noteRequirementInert(definition);
    session.governanceEngine._requirementLiveness.get('tricycle_idle').reported = true;
    session.reset();
    expect(session.governanceEngine._requirementLiveness?.get('tricycle_idle')).toBeUndefined();
  });
});
