import { jest } from '@jest/globals';

// Mock logger
const mockSampled = jest.fn();
const mockInfo = jest.fn();
jest.unstable_mockModule('../../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => ({ sampled: mockSampled, info: mockInfo }),
  getLogger: () => ({ sampled: mockSampled, info: mockInfo })
}));

const { GovernanceEngine } = await import('../../../frontend/src/hooks/fitness/GovernanceEngine.js');

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
    // Initial phase is null
    engine._setPhase(null); // null -> null (no-op)

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
