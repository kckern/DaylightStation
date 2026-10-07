import { describe, expect, it } from 'vitest';
import { INSTALLED_STATE_GATES_POLICY } from './installedStateGatesPolicy.mjs';

describe('installed State Gates policy', () => {
  it('gates Skyline Glider on the same fail-closed school-day decision as piano games', () => {
    expect(INSTALLED_STATE_GATES_POLICY.policy_revision).toBeGreaterThan(2);
    expect(INSTALLED_STATE_GATES_POLICY.entitlements['fitness.skyline-glider']).toEqual({
      gate: 'school.day-complete',
      failure_posture: 'fail_closed',
    });
  });
});
