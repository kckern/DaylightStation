import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DaylightAPI BEFORE importing FitnessSession.
const mockDaylightAPI = vi.fn();
vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: mockDaylightAPI
}));

const { FitnessSession } = await import('./FitnessSession.js');

describe('FitnessSession._checkResumable', () => {
  beforeEach(() => {
    mockDaylightAPI.mockReset();
  });

  it('calls DaylightAPI as a function (not DaylightAPI.get)', async () => {
    mockDaylightAPI.mockResolvedValue({ resumable: false });

    const session = new FitnessSession();
    const result = await session._checkResumable('plex:606203');

    // The bug being fixed: code currently calls DaylightAPI.get(url), which
    // throws TypeError because DaylightAPI is a function, not an object.
    // Expectation: the function form is called exactly once with the right URL.
    expect(mockDaylightAPI).toHaveBeenCalledTimes(1);
    expect(mockDaylightAPI).toHaveBeenCalledWith(
      expect.stringContaining('api/v1/fitness/resumable?contentId=plex%3A606203')
    );
    expect(result).toEqual({ resumable: false });
  });

  it('short-circuits when contentId is empty', async () => {
    const session = new FitnessSession();
    const result = await session._checkResumable('');
    expect(result).toEqual({ resumable: false });
    expect(mockDaylightAPI).not.toHaveBeenCalled();
  });

  it('swallows errors and returns { resumable: false }', async () => {
    mockDaylightAPI.mockRejectedValue(new Error('Network down'));
    const session = new FitnessSession();
    const result = await session._checkResumable('plex:606203');
    expect(result).toEqual({ resumable: false });
  });
});
