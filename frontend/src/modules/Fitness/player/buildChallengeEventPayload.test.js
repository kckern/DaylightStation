import { describe, it, expect } from 'vitest';
import { buildChallengeEventPayload } from './FitnessPlayerOverlay.jsx';

describe('buildChallengeEventPayload', () => {
  it('persists the cycle type', () => {
    const payload = buildChallengeEventPayload({ id: 'c1', type: 'cycle' }, 'pending');
    expect(payload.type).toBe('cycle');
  });

  it('persists null type for an HR/zone challenge', () => {
    const payload = buildChallengeEventPayload({ id: 'c2', zone: 'warm', requiredCount: 1 }, 'pending');
    expect(payload.type).toBeNull();
  });
});
