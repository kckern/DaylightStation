import { describe, expect, it, vi } from 'vitest';
import { RecordPlaybackProgress } from '#apps/content/usecases/RecordPlaybackProgress.mjs';

describe('RecordPlaybackProgress', () => {
  it('preserves the logical namespace across persistence, event, and response contracts', async () => {
    const contentCatalog = {
      resolveSource: vi.fn().mockReturnValue({ source: 'plex', localId: '44' }),
      progressNamespace: vi.fn().mockResolvedValue('watchlist/family-night'),
      getItem: vi.fn().mockResolvedValue({ metadata: { title: 'Lesson' } }),
      listNamespace: vi.fn().mockResolvedValue(null),
    };
    const mediaProgressMemory = {
      findProgress: vi.fn().mockResolvedValue(null),
      saveProgress: vi.fn().mockResolvedValue(undefined),
    };
    const playbackPublications = { progressRecorded: vi.fn() };
    const useCase = new RecordPlaybackProgress({
      contentCatalog,
      mediaProgressMemory,
      playbackPublications,
      createMediaProgress: (props) => ({ ...props }),
      nowTimestamp: () => '2026-08-28 12:00:00',
      nowEpoch: () => 123456,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    const result = await useCase.execute({
      type: 'plex',
      assetId: '44',
      percent: 50,
      seconds: 60,
      watched_duration: 15,
    });

    expect(mediaProgressMemory.findProgress).toHaveBeenCalledWith('plex:44', 'watchlist/family-night');
    expect(mediaProgressMemory.saveProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        contentId: 'plex:44',
        playhead: 60,
        duration: 120,
        percent: 50,
        playCount: 1,
        lastPlayed: '2026-08-28 12:00:00',
        watchTime: 15,
        completedAt: null,
      }),
      'watchlist/family-night',
    );
    expect(playbackPublications.progressRecorded).toHaveBeenCalledWith({
      contentId: 'plex:44',
      type: 'plex',
      assetId: '44',
      percent: 50,
      playhead: 60,
      storagePath: 'watchlist/family-night',
      timestamp: 123456,
    });
    expect(result).toEqual({
      response: {
        type: 'plex',
        library: 'watchlist/family-night',
        title: 'Lesson',
        contentId: 'plex:44',
        playhead: 60,
        duration: 120,
        percent: 50,
        playCount: 1,
        lastPlayed: '2026-08-28 12:00:00',
        watchTime: 15,
        userProgress: undefined,
      },
    });
  });
});
