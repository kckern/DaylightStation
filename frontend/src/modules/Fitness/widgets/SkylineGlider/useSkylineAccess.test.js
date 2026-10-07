import { describe, expect, it } from 'vitest';
import { activeSkylineDecision } from './useSkylineAccess.js';

const decision = (overrides = {}) => ({
  capabilityId: 'fitness.skyline-glider',
  decision: 'granted',
  subject: { kind: 'learner', id: 'test-rider' },
  period: { kind: 'interval', id: 'school-day:2026-10-07', startsAt: 1_000, endsAt: 10_000 },
  validFrom: 2_000,
  validUntil: 8_000,
  ...overrides,
});

describe('activeSkylineDecision', () => {
  it('accepts a decision only inside both its school period and validity window', () => {
    expect(activeSkylineDecision({ items: [decision()] }, 'test-rider', 5_000)).toMatchObject({ decision: 'granted' });
  });

  it('rejects decisions that are not yet valid, expired, or missing validity bounds', () => {
    expect(activeSkylineDecision({ items: [decision()] }, 'test-rider', 1_500)).toBeNull();
    expect(activeSkylineDecision({ items: [decision()] }, 'test-rider', 8_000)).toBeNull();
    expect(activeSkylineDecision({ items: [decision({ validFrom: undefined })] }, 'test-rider', 5_000)).toBeNull();
    expect(activeSkylineDecision({ items: [decision({ validUntil: undefined })] }, 'test-rider', 5_000)).toBeNull();
  });
});
