import { jest } from '@jest/globals';

// Mock logger
const mockSampled = jest.fn();
const mockInfo = jest.fn();
jest.unstable_mockModule('@frontend/lib/logging/Logger.js', () => ({
  default: () => ({ sampled: mockSampled, info: mockInfo }),
  getLogger: () => ({ sampled: mockSampled, info: mockInfo })
}));

const { GovernanceEngine } = await import('@frontend/hooks/fitness/GovernanceEngine.js');

describe('governance phase change logging', () => {
  beforeEach(() => {
    mockSampled.mockClear();
    mockInfo.mockClear();
  });

  test('uses sampled logging for phase changes', () => {
    const engine = new GovernanceEngine();
    engine._setPhase('pending');
    engine._setPhase('unlocked');

    // Should use sampled() not info()
    expect(mockSampled).toHaveBeenCalledWith(
      'governance.phase_change',
      expect.objectContaining({ from: 'pending', to: 'unlocked' }),
      expect.objectContaining({ maxPerMinute: expect.any(Number) })
    );
  });

  test('does not log null to null transitions', () => {
    const engine = new GovernanceEngine();
    // Set phase to null first (constructor sets it to 'pending')
    engine._setPhase(null);
    mockSampled.mockClear();

    // Now try null -> null (should not log)
    engine._setPhase(null);

    expect(mockSampled).not.toHaveBeenCalled();
  });

  test('does not log rapid same-state bounces', () => {
    const engine = new GovernanceEngine();
    engine._setPhase('pending');
    mockSampled.mockClear();

    // Rapid bounce: pending -> pending (should not log)
    engine._setPhase('pending');

    expect(mockSampled).not.toHaveBeenCalled();
  });
});
