/**
 * The inert-requirement alarm is "at most one line per requirement per
 * SESSION". It used to survive reset(), so one warning per page load: on
 * 2026-10-20 it fired in the first session and stayed silent through a later
 * one where the tricycle cadence floor stood down for the whole workout.
 */
import { describe, it, expect } from 'vitest';
import { GovernanceEngine } from "./GovernanceEngine.js";

describe('GovernanceEngine — inert requirement alarm is per session', () => {
  it('reset() forgets which requirements were already reported', () => {
    const engine = new GovernanceEngine();
    const definition = { id: 'tricycle_idle', type: 'cadence_floor', equipment: 'tricycle' };
    engine._noteRequirementInert(definition);
    engine._requirementLiveness.get('tricycle_idle').reported = true;
    engine.reset();
    expect(engine._requirementLiveness?.get('tricycle_idle')).toBeUndefined();
  });
});
