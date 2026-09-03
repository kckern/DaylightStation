import { describe, it, expect } from 'vitest';
import { buildChallengeEventPayload } from './challengeEventPayload.js';

describe('buildChallengeEventPayload', () => {
  it('persists the cycle type', () => {
    const payload = buildChallengeEventPayload({ id: 'c1', type: 'cycle' }, 'pending');
    expect(payload.type).toBe('cycle');
  });

  it('persists null type for an HR/zone challenge', () => {
    const payload = buildChallengeEventPayload({ id: 'c2', zone: 'warm', requiredCount: 1 }, 'pending');
    expect(payload.type).toBeNull();
  });

  it('persists the step sensor, attribution, and reward fields', () => {
    const reward = { awarded: true, rings: 3, zoneId: 'warm' };
    const payload = buildChallengeEventPayload({
      id: 's1', type: 'step', equipment: 'step_mat', metric: 'stomps',
      target: 8, startCount: 12, actualCount: 8, assignedUserId: 'user_2',
      stepsPerMinute: 36, sensorOnline: true, reward,
    }, 'success');
    expect(payload).toEqual(expect.objectContaining({
      type: 'step', equipmentId: 'step_mat', metric: 'stomps', target: 8,
      startCount: 12, assignedUserId: 'user_2', stepsPerMinute: 36,
      sensorOnline: true, reward,
    }));
  });
});
