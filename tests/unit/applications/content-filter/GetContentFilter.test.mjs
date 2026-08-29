import { describe, expect, it, vi } from 'vitest';
import { GetContentFilter } from '#apps/content-filter/usecases/GetContentFilter.mjs';

describe('GetContentFilter', () => {
  it('requires a content-filter repository', () => {
    expect(() => new GetContentFilter()).toThrow('contentFilterRepository');
  });

  it('returns the complete cascade from the repository', async () => {
    const contentFilterRepository = {
      getEdl: vi.fn().mockResolvedValue({ cues: [{ id: 'c1' }] }),
      getProfile: vi.fn().mockResolvedValue({ name: 'family' }),
      getOverride: vi.fn().mockResolvedValue({ source: 'manual' }),
    };
    const useCase = new GetContentFilter({ contentFilterRepository });

    await expect(useCase.execute({ ratingKey: '349222', profileName: 'family' }))
      .resolves.toEqual({
        edl: { cues: [{ id: 'c1' }] },
        profile: { name: 'family' },
        override: { source: 'manual' },
      });
    expect(contentFilterRepository.getEdl).toHaveBeenCalledWith('349222');
    expect(contentFilterRepository.getProfile).toHaveBeenCalledWith('family');
    expect(contentFilterRepository.getOverride).toHaveBeenCalledWith('349222');
  });

  it('does not load optional policy when the title has no EDL', async () => {
    const contentFilterRepository = {
      getEdl: vi.fn().mockResolvedValue(null),
      getProfile: vi.fn(),
      getOverride: vi.fn(),
    };
    const useCase = new GetContentFilter({ contentFilterRepository });

    await expect(useCase.execute({ ratingKey: '999999', profileName: 'family' }))
      .resolves.toEqual({ edl: null, profile: null, override: null });
    expect(contentFilterRepository.getProfile).not.toHaveBeenCalled();
    expect(contentFilterRepository.getOverride).not.toHaveBeenCalled();
  });
});
