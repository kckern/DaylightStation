import { describe, expect, it, vi } from 'vitest';
import { UpdateContentProgress } from '#apps/content/usecases/UpdateContentProgress.mjs';

describe('UpdateContentProgress', () => {
  it('persists the exact progress DTO in the adapter-provided logical namespace', async () => {
    const contentCatalog = {
      resolveSource: vi.fn().mockReturnValue({ source: 'plex', localId: '123' }),
      progressNamespace: vi.fn().mockResolvedValue('plex/library'),
    };
    const mediaProgressMemory = {
      findProgress: vi.fn().mockResolvedValue({ playhead: 20, playCount: 2, watchTime: 12 }),
      saveProgress: vi.fn().mockResolvedValue(undefined),
    };
    const useCase = new UpdateContentProgress({
      contentCatalog,
      mediaProgressMemory,
      nowTimestamp: () => '2026-08-28 12:00:00',
    });

    const result = await useCase.execute({
      source: 'plex',
      localId: '123',
      seconds: 90,
      duration: 100,
    });

    expect(contentCatalog.progressNamespace).toHaveBeenCalledWith(
      { source: 'plex', localId: '123' },
      '123',
    );
    expect(mediaProgressMemory.findProgress).toHaveBeenCalledWith('plex:123', 'plex/library');
    expect(mediaProgressMemory.saveProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        contentId: 'plex:123',
        playhead: 90,
        duration: 100,
        percent: 90,
        playCount: 2,
        lastPlayed: '2026-08-28 12:00:00',
        watchTime: 82,
      }),
      'plex/library',
    );
    expect(mediaProgressMemory.saveProgress.mock.calls[0][0].toJSON()).toEqual({
      contentId: 'plex:123',
      playhead: 90,
      duration: 100,
      percent: 90,
      playCount: 2,
      lastPlayed: '2026-08-28 12:00:00',
      watchTime: 82,
    });
    expect(result).toEqual({
      contentId: 'plex:123',
      playhead: 90,
      duration: 100,
      percent: 90,
      watched: true,
    });
  });

  it('returns null without writing for an unknown source', async () => {
    const mediaProgressMemory = { findProgress: vi.fn(), saveProgress: vi.fn() };
    const useCase = new UpdateContentProgress({
      contentCatalog: { resolveSource: () => null },
      mediaProgressMemory,
      nowTimestamp: vi.fn(),
    });

    await expect(useCase.execute({ source: 'missing', localId: '1', seconds: 1, duration: 2 }))
      .resolves.toBeNull();
    expect(mediaProgressMemory.findProgress).not.toHaveBeenCalled();
    expect(mediaProgressMemory.saveProgress).not.toHaveBeenCalled();
  });
});
