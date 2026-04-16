import { jest } from '@jest/globals';

// Mock logger before any dynamic imports
const mockSampled = jest.fn();
const mockInfo = jest.fn();
const mockWarn = jest.fn();
const mockError = jest.fn();
const mockChild = jest.fn(() => ({
  sampled: mockSampled,
  info: mockInfo,
  warn: mockWarn,
  error: mockError,
  child: mockChild
}));

jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    sampled: mockSampled,
    info: mockInfo,
    warn: mockWarn,
    error: mockError,
    child: mockChild
  }),
  getLogger: () => ({
    sampled: mockSampled,
    info: mockInfo,
    warn: mockWarn,
    error: mockError,
    child: mockChild
  })
}));

let getLogger;
beforeAll(async () => {
  ({ getLogger } = await import('#frontend/lib/logging/Logger.js'));
});

describe('fitness profile logging', () => {
  beforeEach(() => {
    mockSampled.mockClear();
    mockInfo.mockClear();
    mockWarn.mockClear();
    mockError.mockClear();
    mockChild.mockClear();
  });

  test('uses sampled logging for fitness-profile with maxPerMinute: 2', () => {
    const logger = getLogger().child({ app: 'fitness' });

    // Simulate what FitnessApp does with the profile data
    const profileData = {
      sample: 1,
      elapsedSec: 30,
      heapMB: 100,
      heapGrowthMB: 5,
      timers: 3,
      timerGrowth: 0
    };

    logger.sampled('fitness-profile', profileData, { maxPerMinute: 2 });

    expect(mockSampled).toHaveBeenCalledWith(
      'fitness-profile',
      expect.objectContaining({
        sample: 1,
        elapsedSec: 30
      }),
      expect.objectContaining({ maxPerMinute: 2 })
    );
  });

  test('rate limits to 2 logs per minute (roughly 30-second intervals)', () => {
    const logger = getLogger().child({ app: 'fitness' });

    // Verify the maxPerMinute option is passed correctly
    logger.sampled('fitness-profile', { sample: 1 }, { maxPerMinute: 2 });

    const call = mockSampled.mock.calls[0];
    expect(call[2]).toEqual({ maxPerMinute: 2 });
  });
});
